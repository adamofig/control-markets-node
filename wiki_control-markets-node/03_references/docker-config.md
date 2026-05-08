# Docker Configuration & Local Deployment

This guide covers everything related to the docker. 

## Fundamentals

#### Build it:

```bash
docker build -t control-markets-node:latest .
```

#### Run it:
** Usually only to test is working**

```bash
docker run -it --rm control-markets-node:latest
```


#### Run it with Credentials


```bash
docker run -d \
  --name control-markets-node-container \
  -p 8121:8121 \
  --env-file .env \
  -v $(pwd)/.cred/key-dev.json:/app/key.json:ro \
  -e GOOGLE_APPLICATION_CREDENTIALS=/app/key.json \
  control-markets-node:latest
```
