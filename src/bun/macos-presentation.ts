import { dlopen, FFIType } from "bun:ffi";

export type DesktopAppearanceMode = "dock_and_menu" | "dock_only" | "menu_only";

const PROCESS_TRANSFORM_TO_FOREGROUND_APPLICATION = 1;
const PROCESS_TRANSFORM_TO_UI_ELEMENT_APPLICATION = 4;

type ProcessManager = ReturnType<
  typeof dlopen<{
    GetCurrentProcess: {
      args: [typeof FFIType.ptr];
      returns: typeof FFIType.int;
    };
    GetFrontProcess: {
      args: [typeof FFIType.ptr];
      returns: typeof FFIType.int;
    };
    SetFrontProcess: {
      args: [typeof FFIType.ptr];
      returns: typeof FFIType.int;
    };
    TransformProcessType: {
      args: [typeof FFIType.ptr, typeof FFIType.u32];
      returns: typeof FFIType.int;
    };
  }>
>;

type CocoaRuntime = ReturnType<
  typeof dlopen<{
    objc_getClass: {
      args: [typeof FFIType.cstring];
      returns: typeof FFIType.ptr;
    };
    sel_registerName: {
      args: [typeof FFIType.cstring];
      returns: typeof FFIType.ptr;
    };
    objc_msgSend: {
      args: [
        typeof FFIType.ptr,
        typeof FFIType.ptr,
        typeof FFIType.ptr,
        typeof FFIType.ptr,
        typeof FFIType.bool,
      ];
      returns: typeof FFIType.ptr;
    };
  }>
>;

let processManager: ProcessManager | null | undefined;
let cocoaRuntime: CocoaRuntime | null | undefined;

function getProcessManager(): ProcessManager | null {
  if (process.platform !== "darwin") {
    return null;
  }

  if (processManager !== undefined) {
    return processManager;
  }

  try {
    processManager = dlopen(
      "/System/Library/Frameworks/ApplicationServices.framework/ApplicationServices",
      {
        GetCurrentProcess: {
          args: [FFIType.ptr],
          returns: FFIType.int,
        },
        GetFrontProcess: {
          args: [FFIType.ptr],
          returns: FFIType.int,
        },
        SetFrontProcess: {
          args: [FFIType.ptr],
          returns: FFIType.int,
        },
        TransformProcessType: {
          args: [FFIType.ptr, FFIType.u32],
          returns: FFIType.int,
        },
      },
    );
  } catch (error) {
    console.warn("[CloakEnv] Failed to load macOS presentation controls:", error);
    processManager = null;
  }

  return processManager;
}

function getCocoaRuntime(): CocoaRuntime | null {
  if (process.platform !== "darwin") {
    return null;
  }

  if (cocoaRuntime !== undefined) {
    return cocoaRuntime;
  }

  try {
    cocoaRuntime = dlopen("/usr/lib/libobjc.A.dylib", {
      objc_getClass: {
        args: [FFIType.cstring],
        returns: FFIType.ptr,
      },
      sel_registerName: {
        args: [FFIType.cstring],
        returns: FFIType.ptr,
      },
      // `objc_msgSend` is variadic. Passing trailing null/false values keeps the
      // call usable for zero-arg selectors and for performSelectorOnMainThread.
      objc_msgSend: {
        args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.bool],
        returns: FFIType.ptr,
      },
    });
  } catch (error) {
    console.warn("[CloakEnv] Failed to load macOS Objective-C runtime:", error);
    cocoaRuntime = null;
  }

  return cocoaRuntime;
}

function toCStringBuffer(value: string): Uint8Array {
  return Buffer.from(value.endsWith("\0") ? value : `${value}\0`, "utf8");
}

function getSelector(runtime: CocoaRuntime, selectorName: string): bigint | number | null {
  const selector = runtime.symbols.sel_registerName(toCStringBuffer(selectorName));
  return selector || null;
}

function getSharedApplication(runtime: CocoaRuntime): bigint | number | null {
  const nsApplication = runtime.symbols.objc_getClass(toCStringBuffer("NSApplication"));
  if (!nsApplication) {
    return null;
  }

  const sharedApplicationSelector = getSelector(runtime, "sharedApplication");
  if (!sharedApplicationSelector) {
    return null;
  }

  const application = runtime.symbols.objc_msgSend(
    nsApplication,
    sharedApplicationSelector,
    null,
    null,
    false,
  );
  return application || null;
}

function performSelectorOnMainThread(
  target: bigint | number,
  selectorName: string,
  object: bigint | number | null = null,
): boolean {
  const runtime = getCocoaRuntime();
  if (!runtime || !target) {
    return false;
  }

  const performSelector = getSelector(
    runtime,
    "performSelectorOnMainThread:withObject:waitUntilDone:",
  );
  const requestedSelector = getSelector(runtime, selectorName);
  if (!performSelector || !requestedSelector) {
    return false;
  }

  runtime.symbols.objc_msgSend(target, performSelector, requestedSelector, object, false);
  return true;
}

export function applyMacDesktopAppearance(mode: DesktopAppearanceMode): void {
  const manager = getProcessManager();
  if (!manager) {
    return;
  }

  // Electrobun runs app code in a Worker. Keep this helper limited to
  // Carbon/ApplicationServices calls and avoid direct AppKit messaging here.
  const psn = new Uint32Array(2);
  const getCurrentProcessResult = manager.symbols.GetCurrentProcess(psn);
  if (getCurrentProcessResult !== 0) {
    console.warn(
      `[CloakEnv] GetCurrentProcess failed while applying desktop appearance: ${getCurrentProcessResult}`,
    );
    return;
  }

  const transformTarget =
    mode === "menu_only"
      ? PROCESS_TRANSFORM_TO_UI_ELEMENT_APPLICATION
      : PROCESS_TRANSFORM_TO_FOREGROUND_APPLICATION;
  const transformResult = manager.symbols.TransformProcessType(psn, transformTarget);
  if (transformResult !== 0) {
    console.warn(
      `[CloakEnv] TransformProcessType failed while applying desktop appearance: ${transformResult}`,
    );
  }
}

export function isMacApplicationFrontmost(): boolean | null {
  const manager = getProcessManager();
  if (!manager) {
    return null;
  }

  const currentProcess = new Uint32Array(2);
  const frontProcess = new Uint32Array(2);
  if (manager.symbols.GetCurrentProcess(currentProcess) !== 0) {
    return null;
  }
  if (manager.symbols.GetFrontProcess(frontProcess) !== 0) {
    return null;
  }

  return currentProcess[0] === frontProcess[0] && currentProcess[1] === frontProcess[1];
}

export function activateMacApplication(): boolean {
  const manager = getProcessManager();
  if (!manager) {
    return false;
  }

  const currentProcess = new Uint32Array(2);
  if (manager.symbols.GetCurrentProcess(currentProcess) !== 0) {
    return false;
  }

  const setFrontProcessResult = manager.symbols.SetFrontProcess(currentProcess);
  if (setFrontProcessResult !== 0) {
    console.warn(
      `[CloakEnv] SetFrontProcess failed while activating application: ${setFrontProcessResult}`,
    );
    return false;
  }

  return true;
}

export function hideMacApplication(): boolean {
  const runtime = getCocoaRuntime();
  if (!runtime) {
    return false;
  }

  const application = getSharedApplication(runtime);
  if (!application) {
    return false;
  }

  return performSelectorOnMainThread(application, "hide:");
}

export function unhideMacApplication(): boolean {
  const runtime = getCocoaRuntime();
  if (!runtime) {
    return false;
  }

  const application = getSharedApplication(runtime);
  if (!application) {
    return false;
  }

  return performSelectorOnMainThread(application, "unhide:");
}

export function orderOutMacWindow(windowPointer: bigint | number | null): boolean {
  if (!windowPointer) {
    return false;
  }

  return performSelectorOnMainThread(windowPointer, "orderOut:");
}
