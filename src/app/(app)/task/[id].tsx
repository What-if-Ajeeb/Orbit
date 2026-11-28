import { useLocalSearchParams } from 'expo-router';

import { TaskDetail } from '@/components/tasks/TaskDetail';

/** Dedicated mobile detail route. Tablet/web uses the same component inline. */
export default function TaskDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  if (typeof id !== 'string' || id.trim().length === 0) {
    return null;
  }

  return <TaskDetail taskId={id} />;
}
