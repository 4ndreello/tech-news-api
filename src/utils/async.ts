/**
 * Runs async tasks with a concurrency limit. Each task is started as soon as
 * a slot opens, keeping at most `concurrency` tasks in-flight at once.
 *
 * @param tasks  - An iterable of async functions
 * @param concurrency - Maximum number of tasks to run in parallel (default 5)
 * @returns An array of results in task order
 */
export async function withConcurrency<T>(
  tasks: (() => Promise<T>)[],
  concurrency = 5,
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let index = 0;

  async function worker(): Promise<void> {
    while (index < tasks.length) {
      const currentIndex = index++;
      results[currentIndex] = await tasks[currentIndex]();
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, tasks.length) }, () =>
      worker(),
    ),
  );

  return results;
}
