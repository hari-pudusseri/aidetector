import type { Metadata } from "next";
import { Fraunces, Geist } from "next/font/google";
import "./globals.css";

export const dynamic = "force-dynamic";

const geistSans = Geist({
	variable: "--font-geist-sans",
	subsets: ["latin"],
});

const fraunces = Fraunces({
	variable: "--font-fraunces",
	subsets: ["latin"],
	style: ["normal", "italic"],
});

export const metadata: Metadata = {
	title: "Telltale — AI writing detector",
	description: "Paste a draft. See what sounds generated, and what still sounds like a person.",
	icons: { icon: "/favicon.svg" },
};

export default function RootLayout({
	children,
}: Readonly<{
	children: React.ReactNode;
}>) {
	return (
		<html lang="en">
			<body className={`${geistSans.variable} ${fraunces.variable} antialiased`}>{children}</body>
		</html>
	);
}
