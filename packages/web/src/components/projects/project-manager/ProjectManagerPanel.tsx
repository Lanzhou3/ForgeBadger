"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useLanguage } from "@/hooks/use-language";
import {
  attachProjectManagerWorkItemEvidence,
  batchUpdateProjectManagerWorkItemStatuses,
  createProjectManagerWorkItem,
  deleteProjectManagerWorkItem,
  GatewayApiError,
  getProjectManagerGoal,
  getProjectManagerTaskPacket,
  linkProjectManagerTaskPacketSession,
  listProjectManagerLedger,
  listProjectManagerStages,
  listProjectManagerTaskPackets,
  listProjectManagerWorkItemLinks,
  listSessions,
  listProjectManagerWorkItems,
  startProjectManagerTaskPacket,
  updateProjectManagerGoal,
  updateProjectManagerWorkItem,
  updateProjectManagerWorkItemStatus,
  type ProjectManagerEvidenceRef,
  type ProjectManagerGoalInput,
  type ProjectManagerTaskPacket,
  type ProjectManagerWorkItem,
  type ProjectManagerWorkItemInput,
  type ProjectManagerWorkItemStatus,
  type ProjectManagerWorkItemStatusInput,
  type ProjectManagerWorkItemUpdateInput,
  type RuntimeAdapterId,
  type Session,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { taskPacketSelectableSessions } from "../project-manager-task-packet";
import { ProjectManagerGoalBanner } from "./GoalBanner";
import { ProjectManagerPipelineBoard } from "./PipelineBoard";
import { ProjectManagerWorkItemsSection } from "./WorkItemsSection";
import { ProjectManagerWorkItemDetailSheet } from "./WorkItemDetailSheet";
import { QuickStartSessionDialog } from "./QuickStartSessionDialog";
import {
  CreateWorkItemDialog,
  DeleteWorkItemDialog,
  DoneReasonDialog,
  EditWorkItemDialog,
} from "./WorkItemDialogs";
import { ProjectManagerLedgerSection } from "./LedgerSection";
import {
  LEDGER_PAGE_SIZE,
  WORK_ITEM_LIMIT,
  type EditWorkItemDraft,
  type EvidenceDraft,
  type GoalDraft,
  type LedgerFilter,
  type WorkItemDraft,
  type WorkItemStatusFilter,
  type WorkItemViewMode,
} from "./types";
import {
  batchStatusTargets,
  createEditWorkItemDraft,
  createEvidenceDraft,
  createGoalDraft,
  createSingleEvidenceReference,
  createWorkItemDraft,
  createWorkItemInput,
  createWorkItemUpdateInput,
  filterLedgerEvents,
  filterWorkItemsForTable,
  parseProjectManagerTextList,
  projectManagerMutationMessage,
  projectManagerViewStorageKey,
  readProjectManagerViewPrefs,
  validateEvidenceReferenceInput,
  writeProjectManagerViewPrefs,
} from "./utils";

interface ProjectManagerPanelProps {
  projectId: string;
  enabled: boolean;
  selectedWorkItemId?: string | null;
}

export function ProjectManagerPanel({
  projectId,
  enabled,
  selectedWorkItemId: requestedWorkItemId = null,
}: ProjectManagerPanelProps) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const canLoad = enabled && projectId.length > 0;
  const [isGoalEditing, setIsGoalEditing] = useState(false);
  const [goalDraft, setGoalDraft] = useState<GoalDraft>(() => createGoalDraft(null));
  const [goalFormError, setGoalFormError] = useState<string | null>(null);
  const viewStorageKey = projectManagerViewStorageKey(projectId);
  const [workItemStatusFilter, setWorkItemStatusFilter] = useState<WorkItemStatusFilter>(
    () => readProjectManagerViewPrefs(viewStorageKey).statusFilter
  );
  const [workItemViewMode, setWorkItemViewMode] = useState<WorkItemViewMode>(
    () => readProjectManagerViewPrefs(viewStorageKey).viewMode
  );
  const [selectedBoardWorkItemIds, setSelectedBoardWorkItemIds] = useState<string[]>([]);
  const [batchTargetStatus, setBatchTargetStatus] = useState<ProjectManagerWorkItemStatus | "">("");
  const [batchStatusError, setBatchStatusError] = useState<string | null>(null);
  const [selectedWorkItemId, setSelectedWorkItemId] = useState<string | null>(null);
  const [isCreateWorkItemOpen, setIsCreateWorkItemOpen] = useState(false);
  const [workItemDraft, setWorkItemDraft] = useState<WorkItemDraft>(() => createWorkItemDraft());
  const [createWorkItemError, setCreateWorkItemError] = useState<string | null>(null);
  const [editingWorkItemId, setEditingWorkItemId] = useState<string | null>(null);
  const [editWorkItemDraft, setEditWorkItemDraft] = useState<EditWorkItemDraft>(() => createEditWorkItemDraft(null));
  const [editWorkItemError, setEditWorkItemError] = useState<string | null>(null);
  const [deletingWorkItemId, setDeletingWorkItemId] = useState<string | null>(null);
  const [deleteWorkItemError, setDeleteWorkItemError] = useState<string | null>(null);
  const [evidenceDraft, setEvidenceDraft] = useState<EvidenceDraft>(() => createEvidenceDraft());
  const [evidenceAttachError, setEvidenceAttachError] = useState<string | null>(null);
  const [taskPacketSessionId, setTaskPacketSessionId] = useState("");
  const [taskPacketLinkError, setTaskPacketLinkError] = useState<string | null>(null);
  const [taskPacketStartError, setTaskPacketStartError] = useState<string | null>(null);
  const [quickStartPendingId, setQuickStartPendingId] = useState<string | null>(null);
  const [quickStartError, setQuickStartError] = useState<string | null>(null);
  const [quickStartWorkItem, setQuickStartWorkItem] = useState<ProjectManagerWorkItem | null>(null);
  const [ledgerFilter, setLedgerFilter] = useState<LedgerFilter>("all");
  const [ledgerLimit, setLedgerLimit] = useState(LEDGER_PAGE_SIZE);
  const [statusMutationError, setStatusMutationError] = useState<string | null>(null);
  const [pendingDoneWorkItemId, setPendingDoneWorkItemId] = useState<string | null>(null);
  const [doneReason, setDoneReason] = useState("");
  const [doneReasonError, setDoneReasonError] = useState<string | null>(null);
  const doneReasonRef = useRef<HTMLTextAreaElement | null>(null);
  const appliedRequestedWorkItemIdRef = useRef<string | null>(null);

  const goalQuery = useQuery({
    queryKey: ["project-manager", projectId, "goal"],
    queryFn: () => getProjectManagerGoal(projectId),
    enabled: canLoad,
    retry: false,
  });

  const goal = goalQuery.data?.goal ?? null;

  const workItemsQuery = useQuery({
    queryKey: ["project-manager", projectId, "work-items", { limit: WORK_ITEM_LIMIT }],
    queryFn: () => listProjectManagerWorkItems(projectId, { limit: WORK_ITEM_LIMIT }),
    enabled: canLoad,
    retry: false,
  });

  const taskPacketsQuery = useQuery({
    queryKey: ["project-manager", projectId, "task-packets", { limit: WORK_ITEM_LIMIT }],
    queryFn: () => listProjectManagerTaskPackets(projectId, { limit: WORK_ITEM_LIMIT }),
    enabled: canLoad,
    retry: false,
  });

  const stagesQuery = useQuery({
    queryKey: ["project-manager", projectId, "stages"],
    queryFn: () => listProjectManagerStages(projectId),
    enabled: canLoad,
    retry: false,
  });

  const workItemLinksQuery = useQuery({
    queryKey: ["project-manager", projectId, "work-item-links"],
    queryFn: () => listProjectManagerWorkItemLinks(projectId),
    enabled: canLoad,
    retry: false,
  });

  const ledgerQuery = useQuery({
    queryKey: ["project-manager", projectId, "ledger", { limit: ledgerLimit }],
    queryFn: () => listProjectManagerLedger(projectId, { limit: ledgerLimit }),
    enabled: canLoad,
    retry: false,
  });

  const taskPacketQuery = useQuery({
    queryKey: ["project-manager", projectId, "work-item", selectedWorkItemId, "task-packet"],
    queryFn: () => getProjectManagerTaskPacket(projectId, selectedWorkItemId ?? ""),
    enabled: canLoad && !!selectedWorkItemId,
    retry: false,
  });

  const sessionsQuery = useQuery({
    queryKey: ["sessions", { projectId }],
    queryFn: () => listSessions({ projectId }),
    enabled: canLoad && !!selectedWorkItemId,
    retry: false,
  });

  useEffect(() => {
    if (!isGoalEditing) {
      setGoalDraft(createGoalDraft(goal));
    }
  }, [goal, isGoalEditing]);

  useEffect(() => {
    writeProjectManagerViewPrefs(viewStorageKey, {
      statusFilter: workItemStatusFilter,
      viewMode: workItemViewMode,
    });
  }, [viewStorageKey, workItemStatusFilter, workItemViewMode]);

  const invalidateProjectManagerQueries = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["project-manager", projectId, "goal"] }),
      queryClient.invalidateQueries({ queryKey: ["project-manager", projectId, "work-items"] }),
      queryClient.invalidateQueries({ queryKey: ["project-manager", projectId, "task-packets"] }),
      queryClient.invalidateQueries({ queryKey: ["project-manager", projectId, "ledger"] }),
      queryClient.invalidateQueries({ queryKey: ["project-manager", projectId, "stages"] }),
      queryClient.invalidateQueries({ queryKey: ["project-manager", projectId, "work-item-links"] }),
    ]);
  };
  const updateWorkItemsCache = (updater: (items: ProjectManagerWorkItem[]) => ProjectManagerWorkItem[]) => {
    queryClient.setQueriesData<{ workItems: ProjectManagerWorkItem[] }>(
      { queryKey: ["project-manager", projectId, "work-items"] },
      (current) => current ? { workItems: updater(current.workItems) } : current
    );
  };

  const goalMutation = useMutation({
    mutationFn: (input: ProjectManagerGoalInput) => updateProjectManagerGoal(projectId, input),
    onSuccess: async ({ goal: updatedGoal }) => {
      setGoalFormError(null);
      setGoalDraft(createGoalDraft(updatedGoal));
      setIsGoalEditing(false);
      await invalidateProjectManagerQueries();
    },
    onError: (error) => {
      setGoalFormError(projectManagerMutationMessage(error, t("projects.projectManagerGoalMutationError")));
    },
  });

  const createWorkItemMutation = useMutation({
    mutationFn: (input: ProjectManagerWorkItemInput) => createProjectManagerWorkItem(projectId, input),
    onSuccess: async ({ workItem }) => {
      setCreateWorkItemError(null);
      setWorkItemDraft(createWorkItemDraft());
      setIsCreateWorkItemOpen(false);
      updateWorkItemsCache((items) => [...items.filter((item) => item.id !== workItem.id), workItem]);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["project-manager", projectId, "work-items"] }),
        queryClient.invalidateQueries({ queryKey: ["project-manager", projectId, "task-packets"] }),
        queryClient.invalidateQueries({ queryKey: ["project-manager", projectId, "ledger"] }),
      ]);
    },
    onError: (error) => {
      setCreateWorkItemError(projectManagerMutationMessage(error, t("projects.projectManagerCreateWorkItemError")));
    },
  });

  const editWorkItemMutation = useMutation({
    mutationFn: ({ input, workItemId }: { input: ProjectManagerWorkItemUpdateInput; workItemId: string }) =>
      updateProjectManagerWorkItem(projectId, workItemId, input),
    onSuccess: async ({ workItem }) => {
      setEditWorkItemError(null);
      setEditingWorkItemId(null);
      setEditWorkItemDraft(createEditWorkItemDraft(null));
      updateWorkItemsCache((items) => items.map((item) => item.id === workItem.id ? workItem : item));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["project-manager", projectId, "work-items"] }),
        queryClient.invalidateQueries({ queryKey: ["project-manager", projectId, "task-packets"] }),
        queryClient.invalidateQueries({ queryKey: ["project-manager", projectId, "ledger"] }),
      ]);
    },
    onError: (error) => {
      setEditWorkItemError(projectManagerMutationMessage(error, t("projects.projectManagerUpdateWorkItemError")));
    },
  });

  const deleteWorkItemMutation = useMutation({
    mutationFn: ({ workItemId }: { workItemId: string }) =>
      deleteProjectManagerWorkItem(projectId, workItemId, { confirm: true }),
    onSuccess: async ({ workItem }, variables) => {
      setDeleteWorkItemError(null);
      setDeletingWorkItemId(null);
      setSelectedWorkItemId((current) => current === variables.workItemId ? null : current);
      setSelectedBoardWorkItemIds((ids) => ids.filter((id) => id !== variables.workItemId));
      updateWorkItemsCache((items) => items.filter((item) => item.id !== workItem.id));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["project-manager", projectId, "work-items"] }),
        queryClient.invalidateQueries({ queryKey: ["project-manager", projectId, "task-packets"] }),
        queryClient.invalidateQueries({ queryKey: ["project-manager", projectId, "ledger"] }),
      ]);
    },
    onError: (error) => {
      setDeleteWorkItemError(projectManagerMutationMessage(error, t("projects.projectManagerDeleteWorkItemError")));
    },
  });

  const batchStatusMutation = useMutation({
    mutationFn: (input: { updates: Array<{ workItemId: string; status: ProjectManagerWorkItemStatus }> }) =>
      batchUpdateProjectManagerWorkItemStatuses(projectId, input),
    onSuccess: async ({ workItems: updatedWorkItems }) => {
      setBatchStatusError(null);
      setBatchTargetStatus("");
      setSelectedBoardWorkItemIds([]);
      const updatedById = new Map(updatedWorkItems.map((item) => [item.id, item]));
      updateWorkItemsCache((items) => items.map((item) => updatedById.get(item.id) ?? item));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["project-manager", projectId, "work-items"] }),
        queryClient.invalidateQueries({ queryKey: ["project-manager", projectId, "task-packets"] }),
        queryClient.invalidateQueries({ queryKey: ["project-manager", projectId, "ledger"] }),
      ]);
    },
    onError: (error) => {
      setBatchStatusError(projectManagerMutationMessage(error, t("projects.projectManagerBatchStatusError")));
    },
  });

  const statusMutation = useMutation({
    mutationFn: ({ input, workItemId }: { input: ProjectManagerWorkItemStatusInput; workItemId: string }) =>
      updateProjectManagerWorkItemStatus(projectId, workItemId, input),
    onSuccess: async () => {
      setStatusMutationError(null);
      setPendingDoneWorkItemId(null);
      setDoneReason("");
      setDoneReasonError(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["project-manager", projectId, "work-items"] }),
        queryClient.invalidateQueries({ queryKey: ["project-manager", projectId, "task-packets"] }),
        queryClient.invalidateQueries({ queryKey: ["project-manager", projectId, "ledger"] }),
      ]);
    },
    onError: (error) => {
      setStatusMutationError(projectManagerMutationMessage(error, t("projects.projectManagerStatusMutationError")));
    },
  });

  const evidenceMutation = useMutation({
    mutationFn: ({ reference, workItemId }: { reference: ProjectManagerEvidenceRef; workItemId: string }) =>
      attachProjectManagerWorkItemEvidence(projectId, workItemId, { evidenceRefs: [reference] }),
    onSuccess: async () => {
      setEvidenceAttachError(null);
      setEvidenceDraft(createEvidenceDraft());
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["project-manager", projectId, "work-items"] }),
        queryClient.invalidateQueries({ queryKey: ["project-manager", projectId, "task-packets"] }),
        queryClient.invalidateQueries({ queryKey: ["project-manager", projectId, "ledger"] }),
      ]);
    },
    onError: (error) => {
      setEvidenceAttachError(projectManagerMutationMessage(error, t("projects.projectManagerEvidenceAttachError")));
    },
  });

  const taskPacketLinkMutation = useMutation({
    mutationFn: ({ sessionId, workItemId }: { sessionId: string; workItemId: string }) =>
      linkProjectManagerTaskPacketSession(projectId, workItemId, { sessionId }),
    onSuccess: ({ taskPacket }) => {
      setTaskPacketLinkError(null);
      setTaskPacketSessionId(taskPacket.sessionLink?.sessionId ?? "");
      queryClient.setQueryData<{ taskPacket: ProjectManagerTaskPacket }>(
        ["project-manager", projectId, "work-item", taskPacket.workItemId, "task-packet"],
        { taskPacket }
      );
      void queryClient.invalidateQueries({ queryKey: ["project-manager", projectId, "task-packets"] });
    },
    onError: (error) => {
      setTaskPacketLinkError(projectManagerMutationMessage(error, t("projects.projectManagerTaskPacketLinkError")));
    },
  });

  const taskPacketStartMutation = useMutation({
    mutationFn: ({ workItemId, aiTool }: { workItemId: string; aiTool?: RuntimeAdapterId }) =>
      startProjectManagerTaskPacket(projectId, workItemId, { aiTool }),
    onSuccess: ({ taskPacket, session }) => {
      setTaskPacketStartError(null);
      setTaskPacketLinkError(null);
      setQuickStartPendingId(null);
      setQuickStartWorkItem(null);
      setTaskPacketSessionId(taskPacket.sessionLink?.sessionId ?? "");
      queryClient.setQueryData<{ taskPacket: ProjectManagerTaskPacket }>(
        ["project-manager", projectId, "work-item", taskPacket.workItemId, "task-packet"],
        { taskPacket }
      );
      queryClient.setQueryData<{ sessions: Session[] }>(
        ["sessions", { projectId }],
        (current) => current ? {
          sessions: [...current.sessions.filter((existing) => existing.id !== session.id), session],
        } : current
      );
      void queryClient.invalidateQueries({ queryKey: ["project-manager", projectId, "task-packets"] });
      void queryClient.invalidateQueries({ queryKey: ["sessions", { projectId }] });
    },
    onError: (error) => {
      const message = projectManagerMutationMessage(error, t("projects.projectManagerTaskPacketStartError"));
      setTaskPacketStartError(message);
      setQuickStartError(message);
      setQuickStartPendingId(null);
    },
  });

  const firstError = goalQuery.error ?? workItemsQuery.error;
  const isNotFoundError = firstError instanceof GatewayApiError && firstError.status === 404;
  const isLoading = goalQuery.isLoading || workItemsQuery.isLoading;
  const isRefreshing = goalQuery.isFetching || workItemsQuery.isFetching || taskPacketsQuery.isFetching || ledgerQuery.isFetching;
  const workItems = workItemsQuery.data?.workItems ?? [];
  const taskPackets = taskPacketsQuery.data?.taskPackets ?? [];
  const stages = stagesQuery.data?.stages ?? [];
  const workItemLinks = workItemLinksQuery.data?.links ?? [];
  const tableWorkItems = filterWorkItemsForTable(workItems, workItemStatusFilter);
  const ledgerEvents = ledgerQuery.data?.events ?? [];
  const filteredLedgerEvents = filterLedgerEvents(ledgerEvents, ledgerFilter);
  const selectedWorkItem = workItems.find((item) => item.id === selectedWorkItemId) ?? null;
  const taskPacket = taskPacketQuery.data?.taskPacket ?? null;
  const taskPacketSessions = taskPacketSelectableSessions(sessionsQuery.data?.sessions ?? []);
  const editingWorkItem = workItems.find((item) => item.id === editingWorkItemId) ?? null;
  const deletingWorkItem = workItems.find((item) => item.id === deletingWorkItemId) ?? null;
  const selectedBoardWorkItems = selectedBoardWorkItemIds
    .map((id) => workItems.find((item) => item.id === id))
    .filter((item): item is ProjectManagerWorkItem => Boolean(item));
  const batchTargetOptions = batchStatusTargets(selectedBoardWorkItems);
  const effectiveBatchTargetStatus = batchTargetOptions.includes(batchTargetStatus as ProjectManagerWorkItemStatus)
    ? batchTargetStatus
    : "";
  const pendingDoneWorkItem = workItems.find((item) => item.id === pendingDoneWorkItemId) ?? null;

  useEffect(() => {
    const requested = requestedWorkItemId?.trim() ?? "";
    if (!requested) {
      appliedRequestedWorkItemIdRef.current = null;
      return;
    }
    if (appliedRequestedWorkItemIdRef.current === requested) return;
    if (!workItems.some((item) => item.id === requested)) return;
    setSelectedWorkItemId(requested);
    appliedRequestedWorkItemIdRef.current = requested;
  }, [requestedWorkItemId, workItems]);

  useEffect(() => {
    setEvidenceAttachError(null);
    setEvidenceDraft(createEvidenceDraft());
    setTaskPacketLinkError(null);
    setTaskPacketStartError(null);
    setQuickStartError(null);
    setTaskPacketSessionId("");
  }, [selectedWorkItemId]);

  useEffect(() => {
    setTaskPacketSessionId(taskPacket?.sessionLink?.sessionId ?? "");
  }, [taskPacket?.sessionLink?.sessionId]);

  useEffect(() => {
    if (pendingDoneWorkItemId) {
      doneReasonRef.current?.focus();
    }
  }, [pendingDoneWorkItemId]);

  if (!enabled) {
    return null;
  }

  const refresh = () => {
    if (!canLoad) return;
    void goalQuery.refetch();
    void workItemsQuery.refetch();
    void taskPacketsQuery.refetch();
    void ledgerQuery.refetch();
    void stagesQuery.refetch();
    void workItemLinksQuery.refetch();
  };

  const refreshLedger = () => {
    if (!canLoad) return;
    void ledgerQuery.refetch();
  };

  const loadMoreLedger = () => {
    setLedgerLimit((limit) => limit + LEDGER_PAGE_SIZE);
  };

  const startGoalEdit = () => {
    setGoalFormError(null);
    setGoalDraft(createGoalDraft(goal));
    setIsGoalEditing(true);
  };

  const cancelGoalEdit = () => {
    setGoalFormError(null);
    setGoalDraft(createGoalDraft(goal));
    setIsGoalEditing(false);
  };

  const saveGoal = () => {
    const summary = goalDraft.summary.trim();
    if (!summary) {
      setGoalFormError(t("projects.projectManagerGoalSummaryRequired"));
      return;
    }
    setGoalFormError(null);
    goalMutation.mutate({
      summary,
      constraints: parseProjectManagerTextList(goalDraft.constraintsText),
      acceptanceCriteria: parseProjectManagerTextList(goalDraft.acceptanceCriteriaText),
      status: goalDraft.status.trim() || "active",
    });
  };

  const openCreateWorkItemDialog = () => {
    setCreateWorkItemError(null);
    setWorkItemDraft(createWorkItemDraft());
    setIsCreateWorkItemOpen(true);
  };

  const saveWorkItem = () => {
    const title = workItemDraft.title.trim();
    if (!title) {
      setCreateWorkItemError(t("projects.projectManagerWorkItemTitleRequired"));
      return;
    }

    setCreateWorkItemError(null);
    createWorkItemMutation.mutate(createWorkItemInput(workItemDraft, title));
  };

  const openEditWorkItemDialog = (item: ProjectManagerWorkItem) => {
    setEditWorkItemError(null);
    setEditWorkItemDraft(createEditWorkItemDraft(item));
    setEditingWorkItemId(item.id);
  };

  const saveEditedWorkItem = () => {
    if (!editingWorkItem) return;
    const title = editWorkItemDraft.title.trim();
    if (!title) {
      setEditWorkItemError(t("projects.projectManagerWorkItemTitleRequired"));
      return;
    }

    setEditWorkItemError(null);
    editWorkItemMutation.mutate({
      workItemId: editingWorkItem.id,
      input: createWorkItemUpdateInput(editWorkItemDraft, title),
    });
  };

  const openDeleteWorkItemDialog = (item: ProjectManagerWorkItem) => {
    setDeleteWorkItemError(null);
    setDeletingWorkItemId(item.id);
  };

  const confirmDeleteWorkItem = () => {
    if (!deletingWorkItem) return;
    setDeleteWorkItemError(null);
    deleteWorkItemMutation.mutate({ workItemId: deletingWorkItem.id });
  };

  const toggleBoardWorkItemSelection = (item: ProjectManagerWorkItem, selected: boolean) => {
    setBatchStatusError(null);
    setSelectedBoardWorkItemIds((ids) => {
      if (selected) return ids.includes(item.id) ? ids : [...ids, item.id];
      return ids.filter((id) => id !== item.id);
    });
  };

  const submitBatchStatusChange = () => {
    if (selectedBoardWorkItems.length === 0) {
      setBatchStatusError(t("projects.projectManagerBatchStatusSelectionRequired"));
      return;
    }
    if (!effectiveBatchTargetStatus) {
      setBatchStatusError(t("projects.projectManagerBatchStatusTargetRequired"));
      return;
    }

    setBatchStatusError(null);
    batchStatusMutation.mutate({
      updates: selectedBoardWorkItems.map((item) => ({
        workItemId: item.id,
        status: effectiveBatchTargetStatus,
      })),
    });
  };

  const attachEvidence = () => {
    if (!selectedWorkItem) return;
    if (evidenceDraft.kind.trim().length === 0) {
      setEvidenceAttachError(t("projects.projectManagerEvidenceKindRequired"));
      return;
    }
    if (evidenceDraft.referenceType === "file_path" && evidenceDraft.path.trim().length === 0) {
      setEvidenceAttachError(t("projects.projectManagerEvidencePathRequired"));
      return;
    }
    if (
      (evidenceDraft.referenceType === "terminal_snapshot" || evidenceDraft.referenceType === "session") &&
      evidenceDraft.sessionId.trim().length === 0
    ) {
      setEvidenceAttachError(t("projects.projectManagerEvidenceSessionRequired"));
      return;
    }
    const hasGeneratedMarker =
      evidenceDraft.sessionId.trim().length > 0 &&
      (evidenceDraft.referenceType === "terminal_snapshot" || evidenceDraft.referenceType === "session");
    if (evidenceDraft.ref.trim().length === 0 && evidenceDraft.path.trim().length === 0 && !hasGeneratedMarker) {
      setEvidenceAttachError(t("projects.projectManagerEvidenceReferenceRequired"));
      return;
    }
    if (validateEvidenceReferenceInput(evidenceDraft)) {
      setEvidenceAttachError(t("projects.projectManagerEvidenceUnsafeValue"));
      return;
    }

    const reference = createSingleEvidenceReference(evidenceDraft);
    if (!reference) {
      setEvidenceAttachError(t("projects.projectManagerEvidenceReferenceRequired"));
      return;
    }

    setEvidenceAttachError(null);
    evidenceMutation.mutate({ workItemId: selectedWorkItem.id, reference });
  };

  const linkTaskPacketSession = () => {
    if (!selectedWorkItem) return;
    const sessionId = taskPacketSessionId.trim();
    if (!sessionId) {
      setTaskPacketLinkError(t("projects.projectManagerTaskPacketSessionRequired"));
      return;
    }

    setTaskPacketLinkError(null);
    taskPacketLinkMutation.mutate({ workItemId: selectedWorkItem.id, sessionId });
  };

  const startTaskPacket = () => {
    if (!selectedWorkItem) return;
    setTaskPacketStartError(null);
    taskPacketStartMutation.mutate({ workItemId: selectedWorkItem.id });
  };

  const startTaskPacketForItem = (item: ProjectManagerWorkItem) => {
    setQuickStartError(null);
    setQuickStartWorkItem(item);
  };

  const confirmQuickStart = (aiTool: RuntimeAdapterId) => {
    if (!quickStartWorkItem || taskPacketStartMutation.isPending) return;
    setQuickStartError(null);
    setQuickStartPendingId(quickStartWorkItem.id);
    taskPacketStartMutation.mutate({ workItemId: quickStartWorkItem.id, aiTool });
  };

  const requestStatusChange = (item: ProjectManagerWorkItem, nextStatus: ProjectManagerWorkItemStatus) => {
    setStatusMutationError(null);
    if (nextStatus === "done" && item.evidenceRefCount === 0) {
      setPendingDoneWorkItemId(item.id);
      setDoneReason("");
      setDoneReasonError(null);
      return;
    }

    statusMutation.mutate({ workItemId: item.id, input: { status: nextStatus } });
  };

  const confirmDoneWithReason = () => {
    if (!pendingDoneWorkItem) return;
    const manualCompletionReason = doneReason.trim();
    if (!manualCompletionReason) {
      setDoneReasonError(t("projects.projectManagerDoneReasonRequired"));
      return;
    }

    setDoneReasonError(null);
    statusMutation.mutate({
      workItemId: pendingDoneWorkItem.id,
      input: { status: "done", manualCompletionReason },
    });
  };

  return (
    <div className="space-y-5" data-testid="project-manager-panel">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <h2 className="text-sm font-semibold">{t("projects.devTasks")}</h2>
          <p className="text-xs text-muted-foreground">{t("projects.devTasksDescription")}</p>
        </div>
        <Button size="sm" variant="outline" onClick={refresh} disabled={isRefreshing || !canLoad}>
          <RefreshCw className={cn("mr-2 size-4", isRefreshing && "animate-spin")} />
          {t("projects.devTasksRefresh")}
        </Button>
      </div>

      {firstError ? (
        <ProjectManagerError
          message={isNotFoundError
            ? t("projects.projectManagerNotFound")
            : t("projects.projectManagerLoadFailed")}
          onRefresh={refresh}
          refreshing={isRefreshing}
        />
      ) : isLoading ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            {t("projects.projectManagerLoading")}
          </CardContent>
        </Card>
      ) : (
        <>
          <ProjectManagerGoalBanner
            goal={goal}
            t={t}
            draft={goalDraft}
            error={goalFormError}
            isEditing={isGoalEditing}
            isSaving={goalMutation.isPending}
            onCancel={cancelGoalEdit}
            onDraftChange={setGoalDraft}
            onEdit={startGoalEdit}
            onSave={saveGoal}
          />
          <ProjectManagerPipelineBoard
            isFetching={stagesQuery.isFetching || workItemsQuery.isFetching}
            links={workItemLinks}
            onViewDetails={(item) => setSelectedWorkItemId(item.id)}
            projectId={projectId}
            stages={stages}
            t={t}
            taskPackets={taskPackets}
            workItems={workItems}
          />
          <ProjectManagerWorkItemsSection
            batchStatusError={batchStatusError}
            batchStatusPending={batchStatusMutation.isPending}
            batchTargetOptions={batchTargetOptions}
            batchTargetStatus={effectiveBatchTargetStatus}
            isFetching={workItemsQuery.isFetching}
            onBatchStatusSubmit={submitBatchStatusChange}
            onBatchTargetStatusChange={setBatchTargetStatus}
            onClearSelection={() => {
              setBatchStatusError(null);
              setBatchTargetStatus("");
              setSelectedBoardWorkItemIds([]);
            }}
            onCreate={openCreateWorkItemDialog}
            onDelete={openDeleteWorkItemDialog}
            onEdit={openEditWorkItemDialog}
            onQuickStart={startTaskPacketForItem}
            onStatusFilterChange={setWorkItemStatusFilter}
            onStatusChange={requestStatusChange}
            onToggleSelection={toggleBoardWorkItemSelection}
            onViewDetails={(item) => setSelectedWorkItemId(item.id)}
            quickStartError={quickStartError}
            quickStartPendingWorkItemId={quickStartPendingId}
            selectedWorkItemIds={selectedBoardWorkItemIds}
            statusError={statusMutationError}
            statusFilter={workItemStatusFilter}
            statusMutationPending={statusMutation.isPending}
            viewMode={workItemViewMode}
            onViewModeChange={setWorkItemViewMode}
            highlightedWorkItemId={requestedWorkItemId}
            t={t}
            tableWorkItems={tableWorkItems}
            taskPackets={taskPackets}
            taskPacketsError={taskPacketsQuery.error}
            taskPacketsFetching={taskPacketsQuery.isFetching}
            workItems={workItems}
          />
          <ProjectManagerLedgerSection
            error={ledgerQuery.error}
            events={filteredLedgerEvents}
            filter={ledgerFilter}
            hasLoadedEvents={ledgerEvents.length > 0}
            isFetching={ledgerQuery.isFetching}
            onFilterChange={setLedgerFilter}
            onLoadMore={loadMoreLedger}
            onRefresh={refreshLedger}
            refreshing={ledgerQuery.isFetching}
            t={t}
            totalCount={ledgerEvents.length}
            workItems={workItems}
          />
        </>
      )}
      <ProjectManagerWorkItemDetailSheet
        evidenceDraft={evidenceDraft}
        evidenceError={evidenceAttachError}
        isEvidenceSaving={evidenceMutation.isPending}
        isTaskPacketLinking={taskPacketLinkMutation.isPending}
        isTaskPacketLoading={taskPacketQuery.isLoading || sessionsQuery.isLoading}
        isTaskPacketStarting={taskPacketStartMutation.isPending}
        item={selectedWorkItem}
        ledgerEvents={ledgerEvents}
        links={workItemLinks}
        onAttachEvidence={attachEvidence}
        onEvidenceDraftChange={setEvidenceDraft}
        onOpenChange={(open) => {
          if (!open) setSelectedWorkItemId(null);
        }}
        onStatusChange={requestStatusChange}
        onTaskPacketSessionChange={setTaskPacketSessionId}
        onTaskPacketSessionLink={linkTaskPacketSession}
        onTaskPacketStart={startTaskPacket}
        open={!!selectedWorkItem}
        projectId={projectId}
        stages={stages}
        statusMutationPending={statusMutation.isPending}
        t={t}
        taskPacket={taskPacket}
        taskPacketError={taskPacketQuery.error}
        taskPacketLinkError={taskPacketLinkError}
        taskPacketStartError={taskPacketStartError}
        taskPacketSessionId={taskPacketSessionId}
        taskPacketSessions={taskPacketSessions}
        workItems={workItems}
      />
      <QuickStartSessionDialog
        error={quickStartError}
        isStarting={taskPacketStartMutation.isPending}
        item={quickStartWorkItem}
        onConfirm={confirmQuickStart}
        onOpenChange={(open) => {
          if (!open) {
            setQuickStartWorkItem(null);
            setQuickStartError(null);
          }
        }}
        t={t}
        taskPacket={
          quickStartWorkItem
            ? taskPackets.find((packet) => packet.workItemId === quickStartWorkItem.id) ?? null
            : null
        }
      />
      <CreateWorkItemDialog
        draft={workItemDraft}
        error={createWorkItemError}
        isSaving={createWorkItemMutation.isPending}
        onDraftChange={setWorkItemDraft}
        onOpenChange={setIsCreateWorkItemOpen}
        onSave={saveWorkItem}
        open={isCreateWorkItemOpen}
        t={t}
      />
      <EditWorkItemDialog
        draft={editWorkItemDraft}
        error={editWorkItemError}
        isSaving={editWorkItemMutation.isPending}
        item={editingWorkItem}
        onDraftChange={setEditWorkItemDraft}
        onOpenChange={(open) => {
          if (!open) {
            setEditingWorkItemId(null);
            setEditWorkItemError(null);
            setEditWorkItemDraft(createEditWorkItemDraft(null));
          }
        }}
        onSave={saveEditedWorkItem}
        t={t}
      />
      <DeleteWorkItemDialog
        error={deleteWorkItemError}
        isDeleting={deleteWorkItemMutation.isPending}
        item={deletingWorkItem}
        onConfirm={confirmDeleteWorkItem}
        onOpenChange={(open) => {
          if (!open) {
            setDeletingWorkItemId(null);
            setDeleteWorkItemError(null);
          }
        }}
        t={t}
      />
      <DoneReasonDialog
        error={doneReasonError}
        isSaving={statusMutation.isPending}
        onConfirm={confirmDoneWithReason}
        onOpenChange={(open) => {
          if (!open) {
            setPendingDoneWorkItemId(null);
            setDoneReason("");
            setDoneReasonError(null);
          }
        }}
        open={!!pendingDoneWorkItem}
        reason={doneReason}
        reasonRef={doneReasonRef}
        setReason={setDoneReason}
        t={t}
        workItemTitle={pendingDoneWorkItem?.title ?? ""}
      />
    </div>
  );
}

function ProjectManagerError({
  message,
  onRefresh,
  refreshing,
}: {
  message: string;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const { t } = useLanguage();

  return (
    <Card className="border-destructive/50 bg-destructive/10">
      <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="flex items-center gap-2 text-sm text-destructive">
          <AlertTriangle className="size-4" />
          {message}
        </p>
        <Button size="sm" variant="outline" onClick={onRefresh} disabled={refreshing}>
          <RefreshCw className={cn("mr-2 size-4", refreshing && "animate-spin")} />
          {t("projects.devTasksRefresh")}
        </Button>
      </CardContent>
    </Card>
  );
}
