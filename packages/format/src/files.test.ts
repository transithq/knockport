import { describe, expect, it } from "vitest";
import type { Collection, Environment, Request } from "@knockport/core";
import {
  collectionToFiles,
  environmentsToFiles,
  filesToCollection,
  filesToEnvironments,
} from "./files";

function req(id: string, name: string, extra: Partial<Request> = {}): Request {
  return {
    id,
    name,
    method: "GET",
    url: "https://x.test",
    headers: [],
    params: [],
    body: { type: "none" },
    auth: { type: "inherit" },
    ...extra,
  };
}

function makeCollection(): Collection {
  const login = req("req_login", "Login", {
    method: "POST",
    url: "{{baseUrl}}/auth/login",
    body: { type: "json", content: '{"email":"e@x.test"}' },
    scripts: { test: "kp.test('200', () => kp.response.to.have.status(200));" },
    assertions: [{ expression: "status == 200" }],
  });
  const authFolder = {
    id: "fld_auth",
    name: "Auth Folder",
    folders: [],
    requests: [login],
    order: ["req_login"],
  };
  const users = req("req_users", "Get Users", {
    headers: [{ key: "Accept", value: "application/json", enabled: true }],
  });
  return {
    id: "col_disk",
    name: "Disk API",
    description: "disk-backed test",
    auth: { type: "bearer", bearer: { token: "{{token}}" } },
    scripts: { pre: "kp.variables.set('nonce','1');" },
    variables: [{ key: "baseUrl", value: "https://api.x.test", type: "string", enabled: true }],
    folders: [authFolder],
    requests: [users],
    order: ["fld_auth", "req_users"],
    metadata: { createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" },
  };
}

describe("collectionToFiles / filesToCollection", () => {
  it("writes the documented multi-file layout", () => {
    const files = collectionToFiles(makeCollection());
    expect(Object.keys(files).sort()).toEqual([
      "knockport.yaml",
      "requests/Auth-Folder/Login.yaml",
      "requests/Auth-Folder/folder.yaml",
      "requests/Get-Users.yaml",
    ]);
    expect(files["knockport.yaml"]).toContain("name: Disk API");
    expect(files["knockport.yaml"]).toContain("- fld_auth");
    expect(files["requests/Auth-Folder/folder.yaml"]).toContain("id: fld_auth");
    expect(files["requests/Auth-Folder/Login.yaml"]).toContain("method: POST");
  });

  it("round-trips a collection with ids and order intact", () => {
    const original = makeCollection();
    const files = collectionToFiles(original);
    const restored = filesToCollection(files);
    expect(restored.id).toBe("col_disk");
    expect(restored.name).toBe("Disk API");
    expect(restored.auth?.type).toBe("bearer");
    expect(restored.auth?.bearer?.token).toBe("{{token}}");
    expect(restored.variables[0].value).toBe("https://api.x.test");
    expect(restored.order).toEqual(["fld_auth", "req_users"]);
    expect(restored.folders[0].id).toBe("fld_auth");
    expect(restored.folders[0].name).toBe("Auth Folder");
    expect(restored.folders[0].order).toEqual(["req_login"]);
    const login = restored.folders[0].requests[0];
    expect(login.id).toBe("req_login");
    expect(login.body.type).toBe("json");
    expect(login.body.content).toBe('{"email":"e@x.test"}');
    expect(login.assertions?.[0].expression).toBe("status == 200");
    expect(login.scripts?.test).toContain("kp.test");
    expect(restored.requests[0].id).toBe("req_users");
    expect(restored.requests[0].auth.type).toBe("inherit");
  });

  it("byte-stability: writing twice yields identical bytes", () => {
    const original = makeCollection();
    expect(collectionToFiles(original)).toEqual(collectionToFiles(original));
  });

  it("throws for folders without knockport.yaml", () => {
    expect(() => filesToCollection({ "requests/a.yaml": "name: x\n" })).toThrow(/knockport\.yaml/);
  });
});

describe("environments dir round-trip", () => {
  it("serializes and re-parses environments", () => {
    const envs: Environment[] = [
      { id: "env_dev", name: "Dev", variables: [{ key: "host", value: "localhost", enabled: true }] },
      { id: "env_prod", name: "Prod Env", variables: [], isDefault: true },
    ];
    const files = environmentsToFiles(envs);
    expect(Object.keys(files).sort()).toEqual(["environments/Dev.yaml", "environments/Prod-Env.yaml"]);
    const restored = filesToEnvironments(files);
    expect(restored).toHaveLength(2);
    expect(restored.map((e) => e.id).sort()).toEqual(["env_dev", "env_prod"]);
    expect(restored.find((e) => e.id === "env_dev")?.variables[0].value).toBe("localhost");
    expect(restored.find((e) => e.id === "env_prod")?.isDefault).toBe(true);
  });
});
