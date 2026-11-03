import { Events, type Client, type Message } from 'discord.js';

/** Message handling has its own bounded runtime. A slow model never joins the
 * room executor or the evidence recorder, and no message body enters logs. */
export function wireAgentMessages(client: Client, agent: { handle(message: Message): Promise<void> },
  isStopping: () => boolean = () => false, onError: () => void = () => undefined): () => void {
  let active = true;
  const receive = (message: Message): void => {
    if (!active || isStopping()) return;
    void Promise.resolve().then(() => {
      if (active && !isStopping()) return agent.handle(message);
    }).catch(() => onError());
  };
  client.on(Events.MessageCreate, receive);
  return () => { active = false; client.off(Events.MessageCreate, receive); };
}
