# Backend Technical Reference: Organizations and Personal Space

This document outlines the architecture, data structures, and logic of the Organization system built into the Node.js backend. Organizations serve as a logical layer to partition resources (such as Flows, Agents, Tasks) within the same database collections, ensuring robust multitenancy.

## Core Concepts

### Logical Layer Division
Rather than physically separating data (e.g., via separate databases), resources are logically divided via an `orgId` field embedded in most entity documents. Filtering logic enforced via controllers and services scopes queries to ensure a user only accesses data relevant to the correct organizational context.

### Personal Space
Every user has a default "Personal Space" created when they register.
- A "Personal Space" is a standard organization where the `type` is set to `personal`.
- The user's `defaultOrgId` holds the ID of the currently active space. If an operation removes them from their currently active organization, the system automatically falls back to assigning their `defaultOrgId` to their "Personal Space" so the user is never left without an active context.

---

## Technical Implementation

### Data Structures

#### `IOrganization` / `OrganizationEntity` (`src/organization/models/organization.models.ts`)
The main MongoDB schema for organizations.
- `_id`, `id`: Unique identifiers.
- `name`: Human-readable name (for Personal Spaces, this corresponds to the user's email).
- `type`: String denoting whether it is a standard org or `personal`.
- `guests`: Array of users associated with the organization (contains `userId` and `email`).
- *Additional Auditable Fields included via `@dataclouder/nest-core`.*

#### `IUser` / `UserEntity` (`src/user/user.class.ts`)
The main user schema that tracks organizational memberships.
- `defaultOrgId`: A string representing the active organization the user is currently working on. Server-side, this acts as the primary context reference map.
- `organizations`: An array of `IUserOrganization` representing all spaces the user has joined.

#### `IUserOrganization`
A lightweight sub-document inside the User profile tracking joined organizations:
- `orgId`: The ID of the organization.
- `name`: Name of the organization.
- `roles`: User's roles within this organization (defaults to `member`).

---

## Services & Business Logic

#### `AppUserService` (`src/user/user.service.ts`)
Responsible for robust user management, creating the foundation for the personal space upon registration.
- **`registerWithToken`**: Receives decoded Firebase authentication and sets up the user in the database.
- Immediately after user creation, a new personal organization is instantiated (via `OrganizationService`) to act as the user's own isolated workspace.

#### `OrganizationService` (`src/organization/services/organization.service.ts`)
Handles standard CRUD operations and user-organization bridging. It extends `EntityCommunicationService`.
- **`operateUserToOrganization(orgId, dto)`**: Centralized routing method handling addition or removal of users from an organization based on the provided `operation` string (`add` | `remove`).
- **`addUserToOrganization(orgId, email)`**: Safe duplication-checked method that:
  1. Adds a light reference of the user to the organization's `guests` array.
  2. Embeds an `IUserOrganization` object into the user's `organizations` array.
- **`removeUserFromOrganization(orgId, email)`**: Revokes user access from an organization.
  1. Removes the org from the user's `organizations` list and the user from the org's `guests` list.
  2. **Fallback Safety**: If the user's current `defaultOrgId` is identical to the organization they are being removed from, it queries the database for their personal organization (matching their email and `type: 'personal'`) and updates `defaultOrgId` so they aren't left without a valid workspace.

---

## Controllers

#### `OrganizationController` (`src/organization/controllers/organization.controller.ts`)
Exposes REST endpoints inherited from `@dataclouder/nest-mongo` `EntityController` and provides additional custom endpoints.
- **`POST api/organization/:orgId/operate-user`**: Receives an operation payload (`UserOrganizationOperationDto`) to dynamically add or remove guests. The previous `add-user` specific method is deprecated in favor of this new standard.

#### `UserController` (`src/user/user.controller.ts`)
Handles active user synchronization.
- **`GET api/user/logged`**: Resolves the user entity using a Firebase token. If the user is unmapped in the database, it initiates registration, auto-generates their `personal` organization natively, applies it to `defaultOrgId`, and saves the context.

---

## Resource Filtering Logic (Backend View)
Any domain-specific controller extending the core generic entity controllers expects `orgId` as an integrated part of queries (often provided as query parameters from the frontend's `currentOrganization()`).
- The backend ensures that `GET` and `POST` requests save or locate entries where `{ orgId: ... }` aligns with the passed parameters, separating resources perfectly.
- If clients fail to provide a specific `orgId` across endpoints, the implicit strategy defaults back to finding resources correlated to `user.defaultOrgId` or `user._id` (their base context).
