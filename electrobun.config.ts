import type { ElectrobunConfig } from "electrobun/bun";
import packageJson from "./package.json";

const shouldCodeSign = Boolean(process.env.ELECTROBUN_DEVELOPER_ID);
const shouldNotarize =
  shouldCodeSign &&
  Boolean(process.env.ELECTROBUN_APPLEID) &&
  Boolean(process.env.ELECTROBUN_APPLEIDPASS) &&
  Boolean(process.env.ELECTROBUN_TEAMID);
const releaseBaseUrl = process.env.CLOAKENV_RELEASE_BASE_URL?.trim() ?? "";

const config: ElectrobunConfig = {
  app: {
    name: "CloakEnv",
    identifier: "com.cloakenv.vault",
    version: packageJson.version,
    description: "Your secrets, invisible to AI. Encrypted local vault for developer secrets.",
  },

  build: {
    artifactFolder: "artifacts",
    bun: {
      entrypoint: "src/bun/index.ts",
    },
    mac: {
      codesign: shouldCodeSign,
      icons: "icon.iconset",
      notarize: shouldNotarize,
    },
    win: {
      icon: "src/assets/app-icon.ico",
    },
    linux: {
      icon: "src/assets/app-icon.png",
    },

    // Views are pre-built by Vite (for Tailwind CSS processing).
    // ElectroBun copies the Vite output instead of bundling with Bun.build.
    // Run the preBuild script to generate apps/web/dist/ before electrobun build.
    views: undefined,

    copy: {
      "apps/web/dist/index.html": "views/main/index.html",
      "apps/web/dist/assets": "views/main/assets",
      "src/assets/tray-icon-template@2x.png": "views/assets/tray-icon-template@2x.png",
    },
  },

  scripts: {
    preBuild: "src/scripts/prebuild.ts",
    postBuild: "src/scripts/embed-cli.ts",
    postWrap: "src/scripts/embed-cli.ts",
  },

  release: {
    baseUrl: releaseBaseUrl,
    generatePatch: true,
  },

  runtime: {
    exitOnLastWindowClosed: false, // Keep running as tray app
  },
};

export default config;
