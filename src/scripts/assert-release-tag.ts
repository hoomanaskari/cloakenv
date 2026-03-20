import packageJson from "../../package.json";

const gitRef = process.env.GITHUB_REF ?? "";
const gitRefType = process.env.GITHUB_REF_TYPE ?? "";
const gitRefName = process.env.GITHUB_REF_NAME ?? "";

if (gitRefType !== "tag" && !gitRef.startsWith("refs/tags/")) {
  console.log("[cloakenv] release tag validation skipped (not a tag build)");
  process.exit(0);
}

const expectedTag = `v${packageJson.version}`;
const actualTag = gitRefName || gitRef.replace(/^refs\/tags\//, "");

if (actualTag !== expectedTag) {
  throw new Error(
    `Release tag mismatch: expected ${expectedTag} from package.json, received ${actualTag}.`,
  );
}

console.log(`[cloakenv] validated release tag ${actualTag}`);
