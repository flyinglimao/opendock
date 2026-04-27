import CreateAgentForm from "./CreateAgentForm";

export const metadata = {
  title: "Deploy New Agent - OpenDock",
};

export default function CreateAgentPage() {
  return (
    <main className="flex-grow flex items-center justify-center p-gutter w-full max-w-[1280px] mx-auto my-xl">
      <div className="bg-surface-container-lowest rounded-xl shadow-[0px_4px_20px_rgba(0,0,0,0.05)] hover:shadow-[0px_10px_30px_rgba(0,0,0,0.08)] transition-shadow duration-300 w-full max-w-2xl p-lg md:p-10 flex flex-col">
        <header className="mb-xl text-center">
          <h1 className="font-h1 text-h1 font-bold text-on-surface mb-sm">
            Deploy New Agent
          </h1>
          <p className="font-body-sub text-body-sub text-on-surface-variant">
            Configure the parameters and knowledge base for your decentralized
            AI agent.
          </p>
        </header>

        <CreateAgentForm />
      </div>
    </main>
  );
}
