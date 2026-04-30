"use client";
import dynamic from "next/dynamic";

const AgentConsole = dynamic(() => import("./AgentConsole"), { ssr: false });
export default AgentConsole;
