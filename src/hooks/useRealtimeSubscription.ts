import { useEffect } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { RealtimeChannel } from '@supabase/supabase-js';

type TableName =
  | 'equipment'
  | 'equipment_loans'
  | 'equipment_reservations'
  | 'external_equipment_requests'
  | 'lockers'
  | 'locker_loans'
  | 'locker_exchanges'
  | 'lost_items'
  | 'lost_items_archive'
  | 'material_requests'
  | 'classroom_calls'
  | 'classroom_call_rooms'
  | 'classroom_call_responses'
  | 'classroom_call_room_issues'
  | 'profiles'
  | 'tasks'
  | 'task_comments'
  | 'task_team_members'
  | 'task_history'
  | 'user_roles'
  | 'role_permissions'
  | 'rooms'
  | 'room_checklists'
  | 'checklist_questions'
  | 'checklist_answers'
  | 'shift_handovers'
  | 'shift_handover_tasks'
  | 'shift_handover_incidents'
  | 'reservations'
  | 'reservation_rooms'
  | 'inventory_movements'
  | 'activity_logs'
  | 'app_settings';

const tableToQueryKeyMap: Record<TableName, string[]> = {
  equipment: ['equipment'],
  equipment_loans: ['equipment-loans'],
  equipment_reservations: ['equipment-reservations'],
  external_equipment_requests: ['external-equipment-requests'],

  lockers: ['lockers'],
  locker_loans: ['locker-loans'],
  locker_exchanges: ['locker-exchanges'],

  lost_items: [
    'lost-items',
    'lost-items-infinite',
    'lost-item',
    'lost-items-counts',
  ],
  lost_items_archive: ['archived-items', 'lost-items-archive'],

  material_requests: ['material-requests'],

  classroom_calls: ['classroom-calls'],
  classroom_call_rooms: ['classroom-call-rooms'],
  classroom_call_responses: ['classroom-call-responses'],
  classroom_call_room_issues: ['classroom-call-room-issues'],

  profiles: ['profiles', 'users'],
  user_roles: ['users', 'user-permissions'],
  role_permissions: ['role-permissions', 'user-permissions'],

  tasks: ['tasks', 'my-tasks', 'task', 'pending-tasks-count'],
  task_comments: ['task-comments', 'task', 'tasks', 'my-tasks'],
  task_team_members: ['task-team-members', 'my-tasks', 'tasks'],
  task_history: ['task-history', 'task'],

  rooms: ['rooms'],
  room_checklists: ['room-checklists'],
  checklist_questions: ['checklist-questions'],
  checklist_answers: ['checklist-answers', 'room-checklists'],

  shift_handovers: ['shift-handovers'],
  shift_handover_tasks: ['shift-handover-tasks', 'shift-handovers'],
  shift_handover_incidents: ['shift-handover-incidents', 'shift-handovers'],

  reservations: ['reservations'],
  reservation_rooms: ['reservation-rooms'],
  inventory_movements: ['inventory-movements'],
  activity_logs: ['activity-logs'],
  app_settings: ['app-settings'],
};

const getFirstQueryKey = (queryKey: readonly unknown[]) => String(queryKey[0] ?? '');

function invalidateAndRefetchQueries(queryClient: QueryClient, queryKeys: string[]) {
  queryKeys.forEach((key) => {
    queryClient.invalidateQueries({
      predicate: (query) => getFirstQueryKey(query.queryKey) === key,
    });

    queryClient.refetchQueries({
      predicate: (query) => getFirstQueryKey(query.queryKey) === key && query.isActive(),
      type: 'active',
    });
  });
}

function removeDeletedLostItemFromCache(queryClient: QueryClient, deletedId?: string) {
  if (!deletedId) return;

  queryClient.setQueriesData(
    {
      predicate: (query) => getFirstQueryKey(query.queryKey) === 'lost-items-infinite',
    },
    (oldData: any) => {
      if (!oldData?.pages) return oldData;

      return {
        ...oldData,
        pages: oldData.pages.map((page: any) => {
          if (!Array.isArray(page?.items)) return page;

          const itemWasInPage = page.items.some((item: any) => item.id === deletedId);

          return {
            ...page,
            items: page.items.filter((item: any) => item.id !== deletedId),
            totalCount: itemWasInPage
              ? Math.max((page.totalCount ?? page.items.length) - 1, 0)
              : page.totalCount,
          };
        }),
      };
    }
  );

  queryClient.setQueriesData(
    {
      predicate: (query) => getFirstQueryKey(query.queryKey) === 'lost-items',
    },
    (oldData: any) => {
      if (Array.isArray(oldData)) {
        return oldData.filter((item: any) => item.id !== deletedId);
      }

      if (!oldData?.items) return oldData;

      const itemWasInList = oldData.items.some((item: any) => item.id === deletedId);

      return {
        ...oldData,
        items: oldData.items.filter((item: any) => item.id !== deletedId),
        totalCount: itemWasInList
          ? Math.max((oldData.totalCount ?? oldData.items.length) - 1, 0)
          : oldData.totalCount,
      };
    }
  );

  queryClient.removeQueries({
    predicate: (query) =>
      getFirstQueryKey(query.queryKey) === 'lost-item' &&
      query.queryKey.some((value) => value === deletedId),
  });
}

function invalidateRelatedQueries(
  queryClient: QueryClient,
  table: TableName,
  payload?: any
) {
  const relatedKeys = tableToQueryKeyMap[table] || [table];

  if (table === 'lost_items' && payload?.eventType === 'DELETE') {
    const deletedId = payload.old?.id;
    removeDeletedLostItemFromCache(queryClient, deletedId);
  }

  invalidateAndRefetchQueries(queryClient, relatedKeys);
}

export function useRealtimeSubscription(tables: TableName[] = []) {
  const queryClient = useQueryClient();
  const tablesKey = tables.join(',');

  useEffect(() => {
    if (tables.length === 0) return;

    const channels: RealtimeChannel[] = [];

    tables.forEach((table) => {
      const channel = supabase
        .channel(`realtime-${table}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table,
          },
          (payload) => {
            console.log(`Realtime update on ${table}:`, payload.eventType, payload);

            invalidateRelatedQueries(queryClient, table, payload);

            if (table === 'lost_items') {
              console.log('Cache de Achados e Perdidos atualizado/refetch solicitado.');
            }
          }
        )
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            console.log(`Subscribed to realtime updates for ${table}`);
          }

          if (status === 'CHANNEL_ERROR') {
            console.error(`Erro no canal realtime da tabela ${table}`);
          }

          if (status === 'TIMED_OUT') {
            console.warn(`Timeout no canal realtime da tabela ${table}`);
          }

          if (status === 'CLOSED') {
            console.warn(`Canal realtime fechado para tabela ${table}`);
          }
        });

      channels.push(channel);
    });

    return () => {
      channels.forEach((channel) => {
        supabase.removeChannel(channel);
      });
    };
  }, [tablesKey, queryClient]);
}

export function useGlobalRealtimeSubscription() {
  const allTables: TableName[] = [
    'equipment',
    'equipment_loans',
    'equipment_reservations',
    'external_equipment_requests',
    'lockers',
    'locker_loans',
    'locker_exchanges',
    'lost_items',
    'lost_items_archive',
    'material_requests',
    'classroom_calls',
    'classroom_call_rooms',
    'classroom_call_responses',
    'classroom_call_room_issues',
    'profiles',
    'tasks',
    'task_comments',
    'task_team_members',
    'task_history',
    'user_roles',
    'role_permissions',
    'rooms',
    'room_checklists',
    'checklist_questions',
    'checklist_answers',
    'shift_handovers',
    'shift_handover_tasks',
    'shift_handover_incidents',
    'reservations',
    'reservation_rooms',
    'inventory_movements',
    'activity_logs',
    'app_settings',
  ];

  useRealtimeSubscription(allTables);
}
