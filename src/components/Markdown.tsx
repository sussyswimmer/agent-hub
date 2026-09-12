import ReactMarkdown from "react-markdown";

export function Markdown({ text, className = "" }: { text: string; className?: string }) {
  return <div className={`prose-mac text-base ${className}`}><ReactMarkdown>{text}</ReactMarkdown></div>;
}
