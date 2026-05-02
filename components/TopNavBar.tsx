"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { ConnectButton } from "@rainbow-me/rainbowkit";

const navLinks = [
  { href: "/", label: "Explore" },
  { href: "/create", label: "Create" },
  { href: "/chat", label: "Chat" },
  { href: "/dashboard", label: "Dashboard" },
];

export default function TopNavBar() {
  const pathname = usePathname();

  function isActive(href: string) {
    if (href === "/") return pathname === "/" || pathname.startsWith("/agents");
    return pathname.startsWith(href);
  }

  return (
    <header className="bg-white/80 backdrop-blur-md sticky top-0 z-50 border-b border-gray-200 shadow-[0px_4px_20px_rgba(0,0,0,0.05)]">
      <div className="flex items-center justify-between px-6 py-4 max-w-[1280px] mx-auto w-full">
        <Link href="/" className="flex items-center">
          <Image src="/logo.svg" alt="OpenDock" width={133} height={40} priority />
        </Link>

        <nav className="hidden md:flex items-center gap-6">
          {navLinks.map(({ href, label }) =>
            isActive(href) ? (
              <Link
                key={href}
                href={href}
                className="text-indigo-600 font-semibold border-b-2 border-indigo-600 pb-1 transition-all duration-200"
              >
                {label}
              </Link>
            ) : (
              <Link
                key={href}
                href={href}
                className="text-gray-600 hover:text-gray-900 transition-colors hover:bg-gray-50 transition-all duration-200 active:scale-95 px-1"
              >
                {label}
              </Link>
            )
          )}
        </nav>

        <div className="hidden md:block">
          <ConnectButton />
        </div>

        <button className="md:hidden text-gray-600 hover:text-gray-900">
          <span className="material-symbols-outlined">menu</span>
        </button>
      </div>
    </header>
  );
}
