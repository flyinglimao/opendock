import Link from "next/link";

const footerLinks = [
  { href: "#", label: "Documentation" },
  { href: "#", label: "Terms" },
  { href: "#", label: "Privacy" },
  { href: "#", label: "Twitter" },
  { href: "#", label: "GitHub" },
];

export default function Footer() {
  return (
    <footer className="bg-gray-50 py-12 border-t border-gray-200 mt-auto">
      <div className="max-w-[1280px] mx-auto px-6 flex flex-col md:flex-row justify-between items-center gap-6">
        <div className="font-bold text-gray-900">OpenDock</div>
        <div className="flex flex-wrap items-center justify-center gap-6">
          {footerLinks.map(({ href, label }) => (
            <Link
              key={label}
              href={href}
              className="text-sm text-gray-500 hover:text-indigo-600 transition-colors"
            >
              {label}
            </Link>
          ))}
        </div>
        <div className="text-sm text-gray-500">
          © 2024 OpenDock. All rights reserved.
        </div>
      </div>
    </footer>
  );
}
