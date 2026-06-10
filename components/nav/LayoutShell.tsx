"use client";

import { useState, useEffect, useCallback } from "react";
import { usePathname } from "next/navigation";
import TopBar from "./TopBar";
import Sidebar from "@/components/sidebar";
import MobileNavDrawer from "@/components/nav/MobileNavDrawer";
import CommandPalette from "@/components/search/CommandPalette";
import NotificationsPanel from "@/components/notifications/NotificationsPanel";

interface LayoutShellProps {
  children: React.ReactNode;
  userEmail: string;
  userRole: "admin" | "member" | "client";
  isAdmin: boolean;
  clientList: { id: string; name: string }[];
  selectedClientId: string | null;
  selectedClientName: string | null;
  showClientSelector: boolean;
  summaryUpdatedAt: string | null;
  unreadCount: number;
  deliverableBadgeCount: number;
  postsBadgeCount: number;
  servicesBadgeCount: number;
  unviewedDeliverables: { id: string; title: string; viewed_at: string | null }[];
  openThreadDeliverables: {
    deliverableId: string;
    title: string;
    threadCount: number;
  }[];
}

export default function LayoutShell({
  children,
  userEmail,
  userRole,
  isAdmin,
  clientList,
  selectedClientId,
  selectedClientName,
  showClientSelector,
  summaryUpdatedAt,
  unreadCount,
  deliverableBadgeCount,
  postsBadgeCount,
  servicesBadgeCount,
  unviewedDeliverables,
  openThreadDeliverables,
}: LayoutShellProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    const stored = localStorage.getItem("sidebar-collapsed");
    if (stored === "true") setSidebarCollapsed(true);
  }, []);

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem("sidebar-collapsed", String(next));
      return next;
    });
  }, []);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setCommandPaletteOpen(true);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <TopBar
        userEmail={userEmail}
        userRole={userRole}
        clientList={clientList}
        selectedClientId={selectedClientId}
        selectedClientName={selectedClientName}
        showClientSelector={showClientSelector}
        summaryUpdatedAt={summaryUpdatedAt}
        unreadCount={unreadCount}
        onSearchOpen={() => setCommandPaletteOpen(true)}
        onNotificationsOpen={() => setNotificationsOpen(true)}
        onMobileNavOpen={() => setMobileNavOpen(true)}
      />
      <Sidebar
        isAdmin={isAdmin}
        collapsed={sidebarCollapsed}
        onToggle={toggleSidebar}
        deliverableBadgeCount={deliverableBadgeCount}
        postsBadgeCount={postsBadgeCount}
        servicesBadgeCount={servicesBadgeCount}
        onSearchOpen={() => setCommandPaletteOpen(true)}
      />
      {mobileNavOpen && (
        <MobileNavDrawer
          isOpen={mobileNavOpen}
          onClose={() => setMobileNavOpen(false)}
          isAdmin={isAdmin}
          pathname={pathname}
          deliverableBadgeCount={deliverableBadgeCount}
          postsBadgeCount={postsBadgeCount}
          servicesBadgeCount={servicesBadgeCount}
        />
      )}
      <main
        id="main-content"
        className={`pt-14 pb-16 md:pb-0 min-h-screen transition-all duration-200 ${
          sidebarCollapsed ? "md:pl-14" : "md:pl-56"
        }`}
      >
        {children}
      </main>

      {commandPaletteOpen && (
        <CommandPalette
          selectedClientId={selectedClientId}
          onClose={() => setCommandPaletteOpen(false)}
        />
      )}

      {notificationsOpen && (
        <NotificationsPanel
          unviewedDeliverables={unviewedDeliverables}
          openThreadDeliverables={openThreadDeliverables}
          onClose={() => setNotificationsOpen(false)}
        />
      )}
    </div>
  );
}
