import ChatClient from "../ChatClient";

export const metadata = {
  title: "Chat - OpenDock",
};

export default async function ChatConversationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ChatClient selectedConversationId={id} />;
}
