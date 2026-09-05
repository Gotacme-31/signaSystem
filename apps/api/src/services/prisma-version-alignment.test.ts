import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Prisma } from "@prisma/client";

const canonicalVersion = "5.22.0";
const apiPackage = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8"));
const dbPackage = JSON.parse(readFileSync(resolve(process.cwd(), "../../packages/db/package.json"), "utf8"));
const rootPackage = JSON.parse(readFileSync(resolve(process.cwd(), "../../package.json"), "utf8"));
const lockfile = readFileSync(resolve(process.cwd(), "../../pnpm-lock.yaml"), "utf8");

test("Prisma manifests and generated client use the canonical version", () => {
  assert.equal(apiPackage.dependencies["@prisma/client"], canonicalVersion);
  assert.equal(apiPackage.devDependencies.prisma, canonicalVersion);
  assert.equal(dbPackage.dependencies["@prisma/client"], canonicalVersion);
  assert.equal(dbPackage.dependencies.prisma, canonicalVersion);
  assert.equal(rootPackage.dependencies?.["@prisma/client"], undefined);
  assert.equal(rootPackage.devDependencies?.prisma, undefined);
  assert.equal(Prisma.prismaVersion.client, canonicalVersion);
});

test("pnpm lockfile resolves only Prisma 5.22.0", () => {
  assert.match(lockfile, /apps\/api:[\s\S]*?'@prisma\/client':[\s\S]*?specifier: 5\.22\.0/);
  assert.match(lockfile, /apps\/api:[\s\S]*?prisma:[\s\S]*?specifier: 5\.22\.0/);
  const clientVersions = new Set(
    [...lockfile.matchAll(/^  '@prisma\/client@([^']+)':$/gm)]
      .map((match) => match[1].split("(")[0])
  );
  const cliVersions = new Set(
    [...lockfile.matchAll(/^  prisma@([^:]+):$/gm)].map((match) => match[1])
  );
  assert.deepEqual([...clientVersions], [canonicalVersion]);
  assert.deepEqual([...cliVersions], [canonicalVersion]);
});
