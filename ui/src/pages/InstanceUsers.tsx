import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { InstanceUserDirectoryEntry } from "@paperclipai/shared";
import { ApiError } from "@/api/client";
import { accessApi } from "@/api/access";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Search, Shield, Users } from "lucide-react";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { formatDateTime, relativeTime } from "../lib/utils";

function matchesSearch(user: InstanceUserDirectoryEntry, query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  return (
    user.name.toLowerCase().includes(normalized)
    || user.email.toLowerCase().includes(normalized)
  );
}

export function InstanceUsers() {
  const { setBreadcrumbs } = useBreadcrumbs();
  const [search, setSearch] = useState("");

  useEffect(() => {
    setBreadcrumbs([
      { label: "Instance Settings" },
      { label: "Users" },
    ]);
  }, [setBreadcrumbs]);

  const usersQuery = useQuery({
    queryKey: queryKeys.instance.users,
    queryFn: () => accessApi.listInstanceUsers(),
  });

  const filteredUsers = useMemo(
    () => (usersQuery.data ?? []).filter((user) => matchesSearch(user, search)),
    [search, usersQuery.data],
  );

  if (usersQuery.isLoading) {
    return <div className="text-sm text-muted-foreground">Loading signed-up users...</div>;
  }

  if (usersQuery.error) {
    if (usersQuery.error instanceof ApiError && usersQuery.error.status === 403) {
      return (
        <div className="text-sm text-muted-foreground">
          Instance-admin access is required to view signed-up users.
        </div>
      );
    }

    return (
      <div className="text-sm text-destructive">
        {usersQuery.error instanceof Error
          ? usersQuery.error.message
          : "Failed to load signed-up users."}
      </div>
    );
  }

  const totalUsers = usersQuery.data?.length ?? 0;
  const instanceAdminCount = (usersQuery.data ?? []).filter((user) => user.isInstanceAdmin).length;
  const noCompanyAccessCount = (usersQuery.data ?? []).filter((user) => user.companyAccess.length === 0).length;

  return (
    <div className="max-w-5xl space-y-6">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-lg font-semibold">Users</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Review every signed-up account on this instance, including users who have not joined a company yet.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
        <span><span className="font-semibold text-foreground">{totalUsers}</span> total</span>
        <span><span className="font-semibold text-foreground">{instanceAdminCount}</span> instance admins</span>
        <span><span className="font-semibold text-foreground">{noCompanyAccessCount}</span> without company access</span>
      </div>

      <section className="rounded-xl border border-border bg-card p-5">
        <div className="relative max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by name or email"
            className="pl-9"
          />
        </div>
      </section>

      {filteredUsers.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
          {search.trim().length > 0
            ? "No users match the current search."
            : "No signed-up users were found."}
        </div>
      ) : (
        <div className="space-y-4">
          {filteredUsers.map((user) => (
            <Card key={user.id}>
              <CardContent className="space-y-4 p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-sm font-semibold">{user.name}</h2>
                      {user.isInstanceAdmin ? (
                        <Badge variant="default" className="gap-1">
                          <Shield className="h-3 w-3" />
                          Instance admin
                        </Badge>
                      ) : null}
                    </div>
                    <div className="text-sm text-muted-foreground">{user.email}</div>
                  </div>
                  <div
                    className="text-xs text-muted-foreground"
                    title={formatDateTime(user.createdAt)}
                  >
                    Created {relativeTime(user.createdAt)}
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Company Access
                  </div>
                  {user.companyAccess.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-border px-3 py-2 text-sm text-muted-foreground">
                      No company memberships yet.
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {user.companyAccess.map((membership) => (
                        <div
                          key={`${user.id}:${membership.companyId}`}
                          className="rounded-lg border border-border bg-background px-3 py-2"
                          title={formatDateTime(membership.createdAt)}
                        >
                          <div className="text-sm font-medium">{membership.companyName}</div>
                          <div className="text-xs text-muted-foreground">
                            {membership.membershipRole ?? "member"} · {membership.status}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
