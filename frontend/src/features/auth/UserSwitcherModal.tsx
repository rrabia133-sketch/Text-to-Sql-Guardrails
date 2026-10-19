import { useState } from "react";
import { useAuth } from "./AuthContext";

interface UserSwitcherModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export function UserSwitcherModal({ isOpen, onClose }: UserSwitcherModalProps) {
    const { user, availableUsers, login } = useAuth();
    const [submittingUser, setSubmittingUser] = useState<string | null>(null);

    if (!isOpen) return null;

    const handleSelect = async (username: string) => {
        try {
            setSubmittingUser(username);
            await login(username);
            onClose();
        } catch (err) {
            console.error("Failed to switch persona:", err);
        } finally {
            setSubmittingUser(null);
        }
    };

    return (
        <div className="modal-backdrop" onClick={onClose}>
            <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                    <div>
                        <h3 className="modal-title">Switch Session Persona</h3>
                        <p className="modal-subtitle">Select a seed demo user to test role-based access</p>
                    </div>
                    <button className="modal-close-btn" onClick={onClose} aria-label="Close">
                        ✕
                    </button>
                </div>

                <div className="user-persona-list">
                    {availableUsers.map((u) => {
                        const isActive = user?.id === u.id;
                        const isLoading = submittingUser === u.username;

                        return (
                            <button
                                key={u.id}
                                className={`user-persona-card ${isActive ? "active" : ""}`}
                                onClick={() => handleSelect(u.username)}
                                disabled={submittingUser !== null}
                            >
                                <div className="persona-avatar">
                                    {u.role === "admin" ? "🛡️" : "📊"}
                                </div>
                                <div className="persona-details">
                                    <div className="persona-name-row">
                                        <span className="persona-name">{u.displayName}</span>
                                        <span className={`role-pill role-${u.role}`}>{u.role}</span>
                                    </div>
                                    <span className="persona-username">@{u.username}</span>
                                </div>
                                {isActive && <span className="active-badge">Active</span>}
                                {isLoading && <span className="loading-spinner">...</span>}
                            </button>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
