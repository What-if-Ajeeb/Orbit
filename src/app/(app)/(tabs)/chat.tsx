import { AgentChatView } from '@/components/AgentChatView';
import { MASTER_AGENT } from '@/lib/permissions/agents';

/** The Master Agent tab uses the same conversation engine as every specialist. */
export default function ChatScreen() {
  return <AgentChatView agent={MASTER_AGENT} allowCreatorMode showAddMenu />;
}
