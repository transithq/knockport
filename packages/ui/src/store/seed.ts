import type { Collection, Environment, Request } from "@knockport/core";
import { createId } from "@knockport/core";

// ── Seed data ────────────────────────────────────────────────────────────────
// Provides a sample collection + environment so the app isn't empty on first run.
// Mirrors the reference design (E-Commerce API with Authentication / Users folders).

function req(partial: Partial<Request> & Pick<Request, "name" | "method" | "url">): Request {
  return {
    id: createId("req"),
    headers: [],
    params: [],
    body: { type: "none" },
    auth: { type: "inherit" },
    metadata: { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    ...partial,
  };
}

export function createSeedCollection(): Collection {
  const login = req({
    name: "Login",
    method: "POST",
    url: "{{baseUrl}}/v1/auth/login",
    headers: [
      { key: "Content-Type", value: "application/json", enabled: true },
    ],
    body: {
      type: "json",
      content: '{\n  "email": "{{email}}",\n  "password": "{{password}}"\n}',
    },
    scripts: {
      test: 'kp.test("200", () => kp.response.to.have.status(200));\nkp.collectionVariables.set("token", kp.response.json().token);',
    },
  });

  const refreshToken = req({
    name: "Refresh Token",
    method: "POST",
    url: "{{baseUrl}}/v1/auth/refresh",
    headers: [
      { key: "Content-Type", value: "application/json", enabled: true },
    ],
    body: { type: "json", content: '{\n  "refreshToken": "{{refreshToken}}"\n}' },
  });

  const getProfile = req({
    name: "Get Profile",
    method: "GET",
    url: "{{baseUrl}}/v1/users/me",
    params: [
      { key: "include", value: "email,preferences", description: "Fields to include", enabled: true },
      { key: "exclude", value: "sessions", description: "Fields to exclude", enabled: true },
    ],
    auth: { type: "bearer", bearer: { token: "{{token}}" } },
  });

  const updateProfile = req({
    name: "Update Profile",
    method: "PUT",
    url: "{{baseUrl}}/v1/users/me",
    headers: [{ key: "Content-Type", value: "application/json", enabled: true }],
    body: { type: "json", content: '{\n  "name": "Arjun Dev",\n  "theme": "dark"\n}' },
    auth: { type: "bearer", bearer: { token: "{{token}}" } },
  });

  const listUsers = req({
    name: "List Users",
    method: "GET",
    url: "{{baseUrl}}/v1/users",
    params: [
      { key: "page", value: "1", enabled: true },
      { key: "limit", value: "20", enabled: true },
    ],
    auth: { type: "bearer", bearer: { token: "{{token}}" } },
  });

  const deleteUser = req({
    name: "Delete User",
    method: "DELETE",
    url: "{{baseUrl}}/v1/users/{{userId}}",
    auth: { type: "bearer", bearer: { token: "{{token}}" } },
  });

  const authFolder = {
    id: createId("fld"),
    name: "Authentication",
    folders: [],
    requests: [login, refreshToken],
    order: [login.id, refreshToken.id],
  };

  const usersFolder = {
    id: createId("fld"),
    name: "Users",
    folders: [],
    requests: [getProfile, updateProfile, listUsers, deleteUser],
    order: [getProfile.id, updateProfile.id, listUsers.id, deleteUser.id],
  };

  return {
    id: createId("col"),
    name: "E-Commerce API",
    description: "Sample API collection demonstrating KnockPort features",
    auth: { type: "none" },
    variables: [
      { key: "token", value: "", type: "secret", scope: "collection", enabled: true },
      { key: "refreshToken", value: "", type: "secret", scope: "collection", enabled: true },
      { key: "userId", value: "usr_8f3e9d2a", type: "string", scope: "collection", enabled: true },
    ],
    folders: [authFolder, usersFolder],
    requests: [],
    order: [authFolder.id, usersFolder.id],
    metadata: {
      version: "1.0.0",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  };
}

export function createSeedEnvironment(): Environment {
  return {
    id: createId("env"),
    name: "Development",
    isDefault: true,
    variables: [
      { key: "baseUrl", value: "https://api.tropel.dev", type: "string", enabled: true },
      { key: "email", value: "arjun@transithq.dev", type: "string", enabled: true },
      { key: "password", value: "dev-password", type: "secret", enabled: true },
    ],
  };
}

export function createProductionEnvironment(): Environment {
  return {
    id: createId("env"),
    name: "Production",
    isDefault: false,
    variables: [
      { key: "baseUrl", value: "https://api.tropel.io", type: "string", enabled: true },
      { key: "email", value: "arjun@transithq.dev", type: "string", enabled: true },
      { key: "password", value: "{{prod_password}}", type: "secret", enabled: true },
    ],
  };
}
