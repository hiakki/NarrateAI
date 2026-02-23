"use client";

import { useEffect, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  Instagram,
  Youtube,
  Facebook,
  Plus,
  Trash2,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface SocialAccount {
  id: string;
  platform: "INSTAGRAM" | "YOUTUBE" | "FACEBOOK";
  username: string | null;
  pageName: string | null;
  profileUrl: string | null;
  connectedAt: string;
  tokenExpiresAt: string | null;
}

const PLATFORM_CONFIG = {
  INSTAGRAM: {
    name: "Instagram Reels",
    icon: Instagram,
    color: "text-pink-600",
    bgColor: "bg-pink-50",
    connectUrl: "/api/social/connect/instagram",
    description: "Post short-form Reels to your Instagram professional account",
  },
  YOUTUBE: {
    name: "YouTube Shorts",
    icon: Youtube,
    color: "text-red-600",
    bgColor: "bg-red-50",
    connectUrl: "/api/social/connect/youtube",
    description: "Upload Shorts to your YouTube channel",
  },
  FACEBOOK: {
    name: "Facebook Reels",
    icon: Facebook,
    color: "text-blue-600",
    bgColor: "bg-blue-50",
    connectUrl: "/api/social/connect/facebook",
    description: "Post Reels to your Facebook Page",
  },
} as const;

export default function ChannelsPage() {
  const searchParams = useSearchParams();
  const connected = searchParams.get("connected");
  const error = searchParams.get("error");

  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);

  const fetchAccounts = useCallback(async () => {
    try {
      const res = await fetch("/api/social/accounts");
      const json = await res.json();
      if (json.data) setAccounts(json.data);
    } catch (err) {
      console.error("Failed to load accounts:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  async function handleDisconnect(id: string) {
    setDisconnecting(id);
    try {
      const res = await fetch("/api/social/accounts", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (res.ok) {
        setAccounts((prev) => prev.filter((a) => a.id !== id));
      }
    } catch {
      alert("Failed to disconnect account");
    } finally {
      setDisconnecting(null);
    }
  }

  const connectedPlatforms = new Set(accounts.map((a) => a.platform));

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold">Channels</h1>
        <p className="mt-1 text-muted-foreground">
          Connect your social media accounts to auto-publish videos.
        </p>
      </div>

      {connected && (
        <div className="mb-6 rounded-md bg-green-50 border border-green-200 p-3 flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-green-600" />
          <span className="text-sm text-green-700">
            Successfully connected {connected}!
          </span>
        </div>
      )}

      {error && (
        <div className="mb-6 rounded-md bg-red-50 border border-red-200 p-3 flex items-center gap-2">
          <AlertCircle className="h-4 w-4 text-red-600" />
          <span className="text-sm text-red-700">
            Connection failed: {error.replace(/_/g, " ")}
          </span>
        </div>
      )}

      <div className="space-y-4">
        <h2 className="text-lg font-semibold">Connect Platforms</h2>
        <div className="grid gap-4 md:grid-cols-3">
          {(Object.entries(PLATFORM_CONFIG) as [keyof typeof PLATFORM_CONFIG, (typeof PLATFORM_CONFIG)[keyof typeof PLATFORM_CONFIG]][]).map(
            ([key, config]) => {
              const Icon = config.icon;
              const isConnected = connectedPlatforms.has(key);
              return (
                <Card key={key} className={isConnected ? "border-green-200" : ""}>
                  <CardContent className="p-5">
                    <div className="flex items-center gap-3 mb-3">
                      <div className={`p-2 rounded-lg ${config.bgColor}`}>
                        <Icon className={`h-5 w-5 ${config.color}`} />
                      </div>
                      <div>
                        <p className="font-medium text-sm">{config.name}</p>
                        {isConnected && (
                          <Badge
                            variant="secondary"
                            className="text-[10px] text-green-600"
                          >
                            Connected
                          </Badge>
                        )}
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground mb-4">
                      {config.description}
                    </p>
                    <Button
                      size="sm"
                      variant={isConnected ? "outline" : "default"}
                      className="w-full"
                      asChild
                    >
                      <a href={config.connectUrl}>
                        <Plus className="mr-1 h-3 w-3" />
                        {isConnected ? "Add Another" : "Connect"}
                      </a>
                    </Button>
                  </CardContent>
                </Card>
              );
            },
          )}
        </div>
      </div>

      {accounts.length > 0 && (
        <div className="mt-8 space-y-4">
          <h2 className="text-lg font-semibold">Connected Accounts</h2>
          <div className="space-y-3">
            {accounts.map((account) => {
              const config = PLATFORM_CONFIG[account.platform];
              const Icon = config.icon;
              const isExpired =
                account.tokenExpiresAt &&
                new Date(account.tokenExpiresAt) < new Date();

              return (
                <Card
                  key={account.id}
                  className={isExpired ? "border-amber-200" : ""}
                >
                  <CardContent className="flex items-center justify-between p-4">
                    <div className="flex items-center gap-3">
                      <div className={`p-2 rounded-lg ${config.bgColor}`}>
                        <Icon className={`h-4 w-4 ${config.color}`} />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm">
                            {account.username ??
                              account.pageName ??
                              "Unknown"}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {config.name}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Connected{" "}
                          {new Date(account.connectedAt).toLocaleDateString()}
                          {isExpired && (
                            <span className="text-amber-600 ml-2">
                              Token expired - reconnect
                            </span>
                          )}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {account.profileUrl && (
                        <Button variant="ghost" size="icon" asChild>
                          <a
                            href={account.profileUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <ExternalLink className="h-4 w-4" />
                          </a>
                        </Button>
                      )}
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-muted-foreground hover:text-red-600"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>
                              Disconnect Account?
                            </AlertDialogTitle>
                            <AlertDialogDescription>
                              This will remove{" "}
                              {account.username ?? account.pageName} from
                              NarrateAI. Videos will no longer auto-post to this
                              account.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => handleDisconnect(account.id)}
                              disabled={disconnecting === account.id}
                              className="bg-red-600 hover:bg-red-700"
                            >
                              {disconnecting === account.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                "Disconnect"
                              )}
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
