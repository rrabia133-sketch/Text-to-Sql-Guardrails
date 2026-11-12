import type { SVGProps } from "react";

interface IconProps extends SVGProps<SVGSVGElement> {
    size?: number;
}

function SvgBase({ size = 16, children, ...props }: IconProps) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.85"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            {...props}
        >
            {children}
        </svg>
    );
}

export function DatabaseIcon(props: IconProps) {
    return (
        <SvgBase {...props}>
            <ellipse cx="12" cy="5" rx="9" ry="3" />
            <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
            <path d="M3 12c0 1.66 4 3 9 3s9-1.34 9-3" />
        </SvgBase>
    );
}

export function ShieldCheckIcon(props: IconProps) {
    return (
        <SvgBase {...props}>
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            <path d="m9 12 2 2 4-4" />
        </SvgBase>
    );
}

export function SparklesIcon(props: IconProps) {
    return (
        <SvgBase {...props}>
            <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3L12 3Z" />
        </SvgBase>
    );
}

export function PlayIcon(props: IconProps) {
    return (
        <SvgBase {...props}>
            <polygon points="6 3 20 12 6 21 6 3" />
        </SvgBase>
    );
}

export function CopyIcon(props: IconProps) {
    return (
        <SvgBase {...props}>
            <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
            <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
        </SvgBase>
    );
}

export function CheckIcon(props: IconProps) {
    return (
        <SvgBase {...props}>
            <path d="M20 6 9 17l-5-5" />
        </SvgBase>
    );
}

export function HistoryIcon(props: IconProps) {
    return (
        <SvgBase {...props}>
            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
            <path d="M3 3v5h5" />
            <path d="M12 7v5l4 2" />
        </SvgBase>
    );
}

export function LockIcon(props: IconProps) {
    return (
        <SvgBase {...props}>
            <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </SvgBase>
    );
}

export function GlobeIcon(props: IconProps) {
    return (
        <SvgBase {...props}>
            <circle cx="12" cy="12" r="10" />
            <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
            <path d="M2 12h20" />
        </SvgBase>
    );
}

export function TableIcon(props: IconProps) {
    return (
        <SvgBase {...props}>
            <path d="M12 3v18" />
            <rect width="18" height="18" x="3" y="3" rx="2" />
            <path d="M3 9h18" />
            <path d="M3 15h18" />
        </SvgBase>
    );
}

export function TerminalIcon(props: IconProps) {
    return (
        <SvgBase {...props}>
            <polyline points="4 17 10 11 4 5" />
            <line x1="12" x2="20" y1="19" y2="19" />
        </SvgBase>
    );
}

export function DownloadIcon(props: IconProps) {
    return (
        <SvgBase {...props}>
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" x2="12" y1="15" y2="3" />
        </SvgBase>
    );
}

export function AlertTriangleIcon(props: IconProps) {
    return (
        <SvgBase {...props}>
            <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
            <path d="M12 9v4" />
            <path d="M12 17h.01" />
        </SvgBase>
    );
}

export function BanIcon(props: IconProps) {
    return (
        <SvgBase {...props}>
            <circle cx="12" cy="12" r="10" />
            <path d="m4.9 4.9 14.2 14.2" />
        </SvgBase>
    );
}

export function InfoIcon(props: IconProps) {
    return (
        <SvgBase {...props}>
            <circle cx="12" cy="12" r="10" />
            <path d="M12 16v-4" />
            <path d="M12 8h.01" />
        </SvgBase>
    );
}

export function ThumbUpIcon(props: IconProps) {
    return (
        <SvgBase {...props}>
            <path d="M7 10v12" />
            <path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z" />
        </SvgBase>
    );
}

export function ThumbDownIcon(props: IconProps) {
    return (
        <SvgBase {...props}>
            <path d="M17 14V2" />
            <path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z" />
        </SvgBase>
    );
}

export function ArrowRightLeftIcon(props: IconProps) {
    return (
        <SvgBase {...props}>
            <path d="m16 3 4 4-4 4" />
            <path d="M20 7H4" />
            <path d="m8 21-4-4 4-4" />
            <path d="M4 17h16" />
        </SvgBase>
    );
}

export function ChevronIcon({ rotated = false, ...props }: IconProps & { rotated?: boolean }) {
    return (
        <SvgBase
            style={{
                transform: rotated ? "rotate(180deg)" : "rotate(0deg)",
                transition: "transform 0.16s cubic-bezier(0.2, 0, 0, 1)",
            }}
            {...props}
        >
            <path d="m6 9 6 6 6-6" />
        </SvgBase>
    );
}

