/**
 * Optional native-module boundary for Android background recovery.
 *
 * `expo-task-manager` and `expo-background-task` are loaded lazily so a build
 * without their native code cannot crash the whole app at import time. If they
 * are unavailable, recovery simply stays in-process and background scheduling
 * is skipped; all foreground agent behavior is unchanged.
 */
type TaskManagerModule = typeof import('expo-task-manager');
type BackgroundTaskModule = typeof import('expo-background-task');

type TaskExecutor = () => Promise<boolean>;

let taskManager: TaskManagerModule | null = null;
let backgroundTask: BackgroundTaskModule | null = null;

function optionalRequire<T>(load: () => T): T | null {
  try {
    return load();
  } catch (error) {
    console.warn('Optional ORBIT background module is unavailable.', error);
    return null;
  }
}

// Literal requires keep both modules in the Metro graph while still allowing
// this boundary to survive builds without their native code.
// eslint-disable-next-line @typescript-eslint/no-require-imports
taskManager = optionalRequire(() => require('expo-task-manager') as TaskManagerModule);
// eslint-disable-next-line @typescript-eslint/no-require-imports
backgroundTask = optionalRequire(() => require('expo-background-task') as BackgroundTaskModule);

export function defineRecoveryTask(taskName: string, executor: TaskExecutor): void {
  const manager = taskManager;
  const background = backgroundTask;
  if (!manager || !background) return;

  try {
    manager.defineTask(taskName, async () => {
      try {
        await executor();
        return background.BackgroundTaskResult.Success;
      } catch (error) {
        console.warn('ORBIT background recovery failed.', error);
        return background.BackgroundTaskResult.Failed;
      }
    });
  } catch (error) {
    console.warn('Could not define the ORBIT background task.', error);
  }
}

export async function registerRecoveryTask(
  taskName: string,
  minimumInterval: number
): Promise<boolean> {
  const manager = taskManager;
  const background = backgroundTask;
  if (!manager || !background) return false;

  try {
    const status = await background.getStatusAsync();
    if (status !== background.BackgroundTaskStatus.Available) return false;

    if (!(await manager.isTaskRegisteredAsync(taskName))) {
      await background.registerTaskAsync(taskName, { minimumInterval });
    }

    return true;
  } catch (error) {
    console.warn('Could not register the ORBIT background worker.', error);
    return false;
  }
}
