import { create } from "zustand";
import type {
  AuditEntryInfo,
  EnvironmentInfo,
  ProjectInfo,
  ProviderDiagnosticsInfo,
  SecretInfo,
} from "@/hooks/use-rpc";

// Re-export types for convenience
export type Project = ProjectInfo;
export type Secret = SecretInfo;
export type Environment = EnvironmentInfo;
export type AuditEntry = AuditEntryInfo;
export type ProviderDiagnostics = ProviderDiagnosticsInfo;

const ACTIVE_PROJECT_STORAGE_KEY = "cloakenv:active-project-id";
const ACTIVE_ENVIRONMENT_STORAGE_KEY = "cloakenv:active-environment";

type Theme = "dark" | "light";
export type ThemePreference = "system" | "dark" | "light";

interface AppState {
  // Theme
  theme: Theme;
  themePreference: ThemePreference;
  setThemePreference: (preference: ThemePreference) => void;
  syncSystemTheme: () => void;

  // Projects
  projects: Project[];
  activeProjectId: string | null;
  setActiveProject: (id: string | null) => void;
  setProjects: (projects: Project[]) => void;

  // Secrets
  environments: Environment[];
  activeEnvironment: string | null;
  setEnvironments: (environments: Environment[]) => void;
  setActiveEnvironment: (name: string | null) => void;
  secrets: Secret[];
  setSecrets: (secrets: Secret[]) => void;

  // Audit
  auditEntries: AuditEntry[];
  setAuditEntries: (entries: AuditEntry[]) => void;

  // Command palette
  commandPaletteOpen: boolean;
  setCommandPaletteOpen: (open: boolean) => void;
  auditOpen: boolean;
  setAuditOpen: (open: boolean) => void;
  preferencesOpen: boolean;
  setPreferencesOpen: (open: boolean) => void;
  toolPanelOpen: boolean;
  setToolPanelOpen: (open: boolean) => void;
  toolPanelView: "transfer" | "schema" | "policy" | "runtime";
  setToolPanelView: (view: "transfer" | "schema" | "policy" | "runtime") => void;
  addSecretOpen: boolean;
  setAddSecretOpen: (open: boolean) => void;

  // Provider
  providerDiagnostics: ProviderDiagnostics | null;
  setProviderDiagnostics: (diagnostics: ProviderDiagnostics | null) => void;

  // Search
  searchQuery: string;
  setSearchQuery: (query: string) => void;
}

const THEME_PREFERENCE_KEY = "cloakenv:theme-preference";

const initialPreference = readThemePreference();
const initialTheme = resolveTheme(initialPreference);
applyTheme(initialTheme);

export const useAppStore = create<AppState>((set, get) => ({
  theme: initialTheme,
  themePreference: initialPreference,
  setThemePreference: (preference) => {
    writePersistedString(THEME_PREFERENCE_KEY, preference);
    const resolved = resolveTheme(preference);
    applyTheme(resolved);
    set({ themePreference: preference, theme: resolved });
  },
  syncSystemTheme: () => {
    if (get().themePreference !== "system") {
      return;
    }
    const resolved = readSystemTheme();
    applyTheme(resolved);
    set({ theme: resolved });
  },

  projects: [],
  activeProjectId: readPersistedString(ACTIVE_PROJECT_STORAGE_KEY),
  setActiveProject: (id) => {
    writePersistedString(ACTIVE_PROJECT_STORAGE_KEY, id);
    set({ activeProjectId: id });
  },
  setProjects: (projects) => set({ projects }),

  environments: [],
  activeEnvironment: readPersistedString(ACTIVE_ENVIRONMENT_STORAGE_KEY),
  setEnvironments: (environments) => set({ environments }),
  setActiveEnvironment: (name) => {
    writePersistedString(ACTIVE_ENVIRONMENT_STORAGE_KEY, name);
    set({ activeEnvironment: name });
  },

  secrets: [],
  setSecrets: (secrets) => set({ secrets }),

  auditEntries: [],
  setAuditEntries: (entries) => set({ auditEntries: entries }),

  commandPaletteOpen: false,
  setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
  auditOpen: false,
  setAuditOpen: (open) => set({ auditOpen: open }),
  preferencesOpen: false,
  setPreferencesOpen: (open) => set({ preferencesOpen: open }),
  toolPanelOpen: false,
  setToolPanelOpen: (open) => set({ toolPanelOpen: open }),
  toolPanelView: "transfer",
  setToolPanelView: (view) => set({ toolPanelView: view }),
  addSecretOpen: false,
  setAddSecretOpen: (open) => set({ addSecretOpen: open }),

  providerDiagnostics: null,
  setProviderDiagnostics: (diagnostics) => set({ providerDiagnostics: diagnostics }),

  searchQuery: "",
  setSearchQuery: (query) => set({ searchQuery: query }),
}));

function readPersistedString(key: string): string | null {
  try {
    const value = localStorage.getItem(key);
    return value && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

function writePersistedString(key: string, value: string | null): void {
  try {
    if (value) {
      localStorage.setItem(key, value);
      return;
    }

    localStorage.removeItem(key);
  } catch {
    // Ignore storage failures and keep the app usable.
  }
}

function readThemePreference(): ThemePreference {
  try {
    const value = localStorage.getItem(THEME_PREFERENCE_KEY);
    if (value === "dark" || value === "light" || value === "system") {
      return value;
    }
  } catch {
    // Fall through to default.
  }

  return "system";
}

function readSystemTheme(): Theme {
  if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  return "dark";
}

function resolveTheme(preference: ThemePreference): Theme {
  if (preference === "system") {
    return readSystemTheme();
  }

  return preference;
}

function applyTheme(theme: Theme): void {
  if (typeof document === "undefined") {
    return;
  }

  document.documentElement.classList.toggle("dark", theme === "dark");
}
