import CreateAgentForm from "./CreateAgentForm";

export const metadata = {
  title: "Deploy New Agent - OpenDock",
};

export default function CreateAgentPage() {
  return (
    <main className="flex-grow flex items-start justify-center p-gutter w-full max-w-[1440px] mx-auto my-xl">
      <CreateAgentForm />
    </main>
  );
}
