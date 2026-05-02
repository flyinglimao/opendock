import ChatClient from "./ChatClient";

export const metadata = {
  title: "Chat - OpenDock",
};

export default function ChatPage() {
  return <ChatClient selectedConversationId={null} />;
}
