import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
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
  lost_items_archive: ['archived-items'],

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

function invalidateRelatedQueries(
  queryClient: ReturnType<typeof useQueryClient>,
  table: TableName
) {
  const relatedKeys = tableToQueryKeyMap[table] || [table];

  relatedKeys.forEach((key) => {
    queryClient.invalidateQueries({
      predicate: (query) => {
        const firstKey = query.queryKey[0];
        return firstKey === key;
      },
    });
  });
}

export function useRealtimeSubscription(tables: TableName[] = []) {
  const queryClient = useQueryClient();

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

            invalidateRelatedQueries(queryClient, table);

            if (table === 'lost_items') {
              console.log('Invalidando cache de Achados e Perdidos...');
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
  }, [tables.join(','), queryClient]);
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
