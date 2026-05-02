import Image from "next/image";
import Link from "next/link";

export default function Footer() {
  return (
    <footer className="bg-gray-50 py-12 border-t border-gray-200 mt-auto">
      <div className="max-w-[1280px] mx-auto px-6 flex flex-col md:flex-row justify-between items-center gap-6">
        <div className="flex items-center gap-6">
          <Image src="/logo.svg" alt="OpenDock" width={133} height={40} />
          <Link
            href="https://github.com/flyinglimao/opendoc"
            className="text-sm text-gray-500 hover:text-indigo-600 transition-colors"
            target="_blank"
            rel="noopener noreferrer"
          >
            GitHub
          </Link>
        </div>
        <div className="text-sm text-gray-500">
          © 2026 OpenDock. All rights reserved.
        </div>
      </div>
    </footer>
  );
}
