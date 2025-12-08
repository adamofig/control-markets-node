# ==============================================================================
# PASSWORDLESS DEPLOYMENT SETUP
# ==============================================================================
# To deploy without password prompts, you need to use SSH key-based authentication
# and configure passwordless sudo on the remote server.
#
# 1. Generate an SSH Key Pair (if you don't have one):
#    ssh-keygen -t rsa -b 4096
#
# 2. Copy your public key to the remote server:
#    ssh-copy-id $(TARGET_USER)@$(TARGET_HOST)
#
# 3. Configure passwordless sudo for Docker on the remote server:
#    a. SSH into the remote server: ssh $(TARGET_USER)@$(TARGET_HOST)
#    b. Edit the sudoers file: sudo visudo
#    c. Add this line at the end: $(TARGET_USER) ALL=(ALL) NOPASSWD: /usr/bin/docker
#
# ==============================================================================
# Shell & Formatting
# ==============================================================================
.PHONY: help deploy-local deploy-homelab deploy-gcp start clean
.DEFAULT_GOAL := help

# Variables for deployment
PROJECT_ID ?= control-markets-dev
IMAGE_NAME ?= $(PROJECT_ID)-node-image
REGION ?= us-central1
SERVICE_NAME ?= $(PROJECT_ID)-node-server

# Silences command output, use `make V=1` to see verbose output
V ?= 0
ifeq ($(V), 0)
	MAKE_VERBOSE = @
else
	MAKE_VERBOSE =
endif

BLUE := \033[1;34m
NC   := \033[0m # No Color

# ==============================================================================
# Generic Project Configuration
# ==============================================================================
# Load environment variables from .env file if it exists
-include .env

# --- Docker & Container ---
PROJECT_NAME         ?= control-markets-node
PROJECT_ID           ?= control-markets-dev
IMAGE_FILENAME       := $(PROJECT_NAME).tar
CONTAINER_NAME       ?= $(PROJECT_NAME)-container
HOST_PORT            ?= 8121
INNER_PORT           ?= 8121

# --- GCP Configuration ---
PROJECT_ID           ?= dataclouder-dev#❗️
GCP_REGION           ?= us-central1#❗️
GCP_SERVICE_NAME     ?= $(PROJECT_NAME)-node
ARTIFACT_REGISTRY_REPO        := us-central1-docker.pkg.dev/$(PROJECT_ID)/images/$(PROJECT_NAME)


# --- Credential Configuration ---
# Define paths for different environments
ENV_FILE_QA          ?= .env.qa
KEY_FILE_QA          ?= ./.cred/key-qa.json
ENV_FILE_PRO         ?= .env
KEY_FILE_PRO         ?= ./.cred/key-dev.json
ENV_FILE_HOMELAB     ?= .env.homelab

# If your remote user needs a password for sudo, set it here or in your .env file.
# It will be piped to sudo -S. Leave empty to use passwordless sudo.
REMOTE_SUDO_PASSWORD ?= **

# If REMOTE_SUDO_PASSWORD is set, configure commands to use it for SSH authentication.
# This requires the `sshpass` utility to be installed on your local machine.
# On macOS: brew install sshpass
# On Debian/Ubuntu: sudo apt-get install sshpass
SSH_CMD = ssh
SCP_CMD = scp
ifneq ($(strip $(REMOTE_SUDO_PASSWORD)),)
	SSH_CMD = sshpass -p '$(REMOTE_SUDO_PASSWORD)' ssh
	SCP_CMD = sshpass -p '$(REMOTE_SUDO_PASSWORD)' scp
endif

# --- Target-Specific Variables (set by deploy targets) ---
TARGET_USER          ?= local
TARGET_HOST          ?= localhost
REMOTE_DEPLOY_PATH   ?= ~/Documents
PLATFORM             ?= linux/amd64 # Default platform
# These will be overridden by deploy targets
TARGET_ENV_FILE      := $(ENV_FILE_QA)
TARGET_KEY_FILE      := $(KEY_FILE_QA)

# --- Computed Variables ---
REMOTE_TAR_FILEPATH  := $(REMOTE_DEPLOY_PATH)/$(IMAGE_FILENAME)
REMOTE_CONFIG_PATH   := $(REMOTE_DEPLOY_PATH)/config
ARTIFACT_REGISTRY_REPO        := us-central1-docker.pkg.dev/$(PROJECT_ID)/images/$(PROJECT_NAME)

# ==============================================================================
# USER-FACING DEPLOYMENT TARGETS
# ==============================================================================

# Deploy to Local Docker (ARM64)
deploy-local: PLATFORM = linux/arm64
deploy-local: ._build-docker ._deploy-local
	@echo "✅ Deployment to local Docker completed successfully."

# Deploy to Homelab Server (ARM64)
deploy-homelab: TARGET_USER = adamo
deploy-homelab: TARGET_HOST = home.lab
deploy-homelab: REMOTE_DEPLOY_PATH = /home/adamo/Documents
deploy-homelab: PLATFORM = linux/arm64
deploy-homelab: TARGET_ENV_FILE = $(ENV_FILE_HOMELAB)
deploy-homelab: TARGET_KEY_FILE = $(KEY_FILE_PRO)
deploy-homelab: ._build-docker ._transfer-docker-image ._transfer-credentials ._deploy-remote ._local-cleanup
	@echo "✅ Deployment to Homelab ($(TARGET_HOST)) completed successfully."

# Deploy to AI Lab Server (AMD64)
deploy-ailab: TARGET_USER = adamo
deploy-ailab: TARGET_HOST = 192.168.2.2
deploy-ailab: REMOTE_DEPLOY_PATH = /home/adamo/Documents
deploy-ailab: PLATFORM = linux/amd64
deploy-ailab: TARGET_ENV_FILE = $(ENV_FILE_PRO)
deploy-ailab: TARGET_KEY_FILE = $(KEY_FILE_PRO)
deploy-ailab: ._build-docker ._transfer-docker-image ._transfer-credentials ._deploy-remote ._local-cleanup
	@echo "✅ Deployment to AI Lab http://$(TARGET_HOST):$(HOST_PORT) completed successfully."

# Deploy to Google Cloud Platform (GCP)
deploy-cloud-run: build-and-save-in-gcp-artifact-registry deploy-service
	@echo "✅ Deployment to GCP completed successfully."


# ==============================================================================
# INTERNAL HELPER TARGETS
# ==============================================================================

._build-docker:
	@echo "1) 🐳 Building Docker image [$(PROJECT_NAME):latest] for [$(PLATFORM)]..."
	$(MAKE_VERBOSE) docker build --platform $(PLATFORM) -t $(PROJECT_NAME):latest .

._transfer-docker-image:
	@echo "2) 💾 Saving Docker image to [$(IMAGE_FILENAME)]..."
	$(MAKE_VERBOSE) docker save $(PROJECT_NAME):latest -o $(IMAGE_FILENAME)
	@echo "3) 🚚 Transferring [$(IMAGE_FILENAME)] to [$(TARGET_USER)@$(TARGET_HOST):$(REMOTE_TAR_FILEPATH)]..."
	$(MAKE_VERBOSE) $(SCP_CMD) $(IMAGE_FILENAME) $(TARGET_USER)@$(TARGET_HOST):$(REMOTE_TAR_FILEPATH)

._transfer-credentials:
	@echo "4) 🔐 Transferring credentials to [$(TARGET_HOST)] env [$(REMOTE_CONFIG_PATH)/.env] key [$(REMOTE_CONFIG_PATH)/key.json]..."
	$(MAKE_VERBOSE) $(SSH_CMD) $(TARGET_USER)@$(TARGET_HOST) "mkdir -p $(REMOTE_CONFIG_PATH)"
	$(MAKE_VERBOSE) $(SCP_CMD) $(TARGET_ENV_FILE) $(TARGET_USER)@$(TARGET_HOST):$(REMOTE_CONFIG_PATH)/.env
	$(MAKE_VERBOSE) $(SCP_CMD) $(TARGET_KEY_FILE) $(TARGET_USER)@$(TARGET_HOST):$(REMOTE_CONFIG_PATH)/key.json

._deploy-remote:
	@echo "5) ⚙️  Deploying on remote host [$(TARGET_HOST)]..."
	$(MAKE_VERBOSE) $(SSH_CMD) -t $(TARGET_USER)@$(TARGET_HOST) '\
		set -e; \
		if [ -n "$(REMOTE_SUDO_PASSWORD)" ]; then \
			SUDO_CMD="echo \"$(REMOTE_SUDO_PASSWORD)\" | sudo -S"; \
		else \
			SUDO_CMD="sudo"; \
		fi; \
		echo "  -> 🐳 Loading Docker image..."; \
		eval $$SUDO_CMD docker load -i $(REMOTE_TAR_FILEPATH); \
		echo "  -> 🛑 Stopping existing container [$(CONTAINER_NAME)]..."; \
		eval $$SUDO_CMD docker stop $(CONTAINER_NAME) || true; \
		echo "  -> 🗑️  Removing existing container [$(CONTAINER_NAME)]..."; \
		eval $$SUDO_CMD docker rm $(CONTAINER_NAME) || true; \
		echo "  -> 🚀 Starting new container [$(CONTAINER_NAME)]..."; \
		eval $$SUDO_CMD docker run -d \
			--name $(CONTAINER_NAME) \
			--env-file $(REMOTE_CONFIG_PATH)/.env \
			-v $(REMOTE_CONFIG_PATH)/key.json:/usr/src/app/.cred/key.json:ro \
			-e GOOGLE_APPLICATION_CREDENTIALS=/usr/src/app/.cred/key.json \
			-p $(HOST_PORT):$(INNER_PORT) \
			--restart unless-stopped \
			$(PROJECT_NAME):latest; \
		echo "  -> 🧹 Cleaning up remote tarball..."; \
		rm $(REMOTE_TAR_FILEPATH); \
		echo "  -> ✅ Remote deployment finished check on http://$(TARGET_HOST):$(HOST_PORT)" '

._deploy-local:
	@echo "2) 🚀 Deploying on local Docker..."
	@echo "  -> 🛑 Stopping and removing existing container [$(CONTAINER_NAME)] IF EXISTS..."
	-$(MAKE_VERBOSE) docker stop $(CONTAINER_NAME) || true
	-$(MAKE_VERBOSE) docker rm $(CONTAINER_NAME) || true
	@echo "  -> 🚀 Starting new container [$(CONTAINER_NAME)]..."
	$(MAKE_VERBOSE) docker run -d \
		--env-file .env \
		--name $(CONTAINER_NAME) \
		-p $(HOST_PORT):$(INNER_PORT) \
		--restart unless-stopped \
		-v $(shell pwd)/.cred/key-qa.json:/usr/src/app/.cred/key-qa.json:ro \
		-e GOOGLE_APPLICATION_CREDENTIALS=/usr/src/app/.cred/key-qa.json \
		$(PROJECT_NAME):latest
	@echo "  -> ✅ Local deployment finished check on http://localhost:$(HOST_PORT)"

._local-cleanup:
	@echo "6) 🧹 Cleaning up local tarball [$(IMAGE_FILENAME)]..."
	$(MAKE_VERBOSE) rm -f $(IMAGE_FILENAME)

# ==============================================================================
# GCP DEPLOYMENT TARGETS
# ==============================================================================
# 🥇 To deploy RUN ONLY the First Time to garantee you have cloud build and cloud run.
gcp-enable-services:
	@echo "🚀 Enabling required services for $(PROJECT_ID)...🔧"
	gcloud config set project $(PROJECT_ID)
	gcloud services enable run.googleapis.com
	gcloud services enable cloudbuild.googleapis.com
	gcloud services enable artifactregistry.googleapis.com


build-and-save-in-gcp-artifact-registry:
	@echo " 🐳 -> Building docker in GCP with tag $(ARTIFACT_REGISTRY_REPO) and pushing to Google Container Registry..."
	gcloud builds submit --project $(PROJECT_ID) --tag $(ARTIFACT_REGISTRY_REPO) .

# Build the Docker image and push to Google Container Registry


# Deploy to Cloud Run, use .env variables except GOOGLE_APPLICATION_CREDENTIALS
deploy-service:
	@echo " 🚀 Deploying to Cloud Run..."
	@echo " 🚨 NOTE: Your Current ENV variables will be parsed and deployed to Cloud Run. 🪪"
	@ENV_VARS=$$(node scripts/env_parser.js); \
	echo "🔑 Double check your Environment Variables to be deployed: 🔑"; \
	echo "$${ENV_VARS}" | tr ',' '\n'; \
	gcloud run deploy $(GCP_SERVICE_NAME) \
		--project $(PROJECT_ID) \
		--image $(ARTIFACT_REGISTRY_REPO) \
		--platform managed \
		--region $(GCP_REGION) \
		--allow-unauthenticated \
		--set-env-vars "$${ENV_VARS}"
	@echo "Deployment complete! You can check the status using:"
	@echo "gcloud run services describe $(GCP_SERVICE_NAME) --region $(GCP_REGION)"

# ==============================================================================
# DEVELOPMENT & UTILITY TARGETS
# ==============================================================================
start:
	npm run start:dev

update-dc:
	npm run update:dc

update-all:
	ncu -u

publish-mongo:
	npm run publish:mongo

publish-google-cloud:
	npm run publish:google-cloud

clean:
	@echo "🧹 Removing node_modules..."
	$(MAKE_VERBOSE) rm -rf node_modules

merge-upstream:
	@echo "Fetching and merging updates from upstream repository..."
	@if ! git config remote.upstream.url > /dev/null; then \
		echo "Adding upstream remote..."; \
		git remote add upstream https://github.com/dataclouder-dev/startup-template-node.git; \
	fi
	git fetch upstream
	git checkout main
	@echo "Merging upstream/main into local main branch..."
	git merge upstream/main --allow-unrelated-histories || { \
		echo "Merge conflicts detected. Please resolve conflicts and complete the merge manually."; \
		echo "After resolving conflicts, commit changes and push to origin."; \
		exit 1; \
	}

# ==============================================================================
# HELP
# ==============================================================================
help:
	@echo "Usage: make [target]"
	@echo ""
	@echo "----------------------------------------------------------------------"
	@echo "  Deployment Targets"
	@echo "----------------------------------------------------------------------"
	@echo "  $(BLUE)make deploy-local$(NC)      - Build and deploy the app to your local Docker."
	@echo "  $(BLUE)make deploy-homelab$(NC)    - Build and deploy the app to the Homelab server."
	@echo "  $(BLUE)make deploy-gcp$(NC)        - Build and deploy the app to Google Cloud Run."
	@echo ""
	@echo "----------------------------------------------------------------------"
	@echo "  Development"
	@echo "----------------------------------------------------------------------"
	@echo "  $(BLUE)make start$(NC)             - Run the dev server."
	@echo "  $(BLUE)make clean$(NC)             - Remove node_modules."
	@echo ""
	@echo "Run 'make [target] V=1' for verbose output."
	@echo ""
