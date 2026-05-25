import { useState, useMemo, useEffect, useRef } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { 
  Search, 
  Package, 
  Loader2, 
  FileDown, 
  Gift, 
  Trash2, 
  Upload,
  X,
  CheckSquare,
  FileSpreadsheet,
  ImageIcon,
  Archive,
  Zap,
  MoreHorizontal,
  Settings2
} from 'lucide-react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { VirtualizedItemsList } from '@/components/items/VirtualizedItemsList';
import { BulkImageUploadDialog } from '@/components/items/BulkImageUploadDialog';
import { ArchiveDeliveredItemsDialog } from '@/components/items/ArchiveDeliveredItemsDialog';
import { StorageConfigDialog } from '@/components/items/StorageConfigDialog';
import { useNavigate } from 'react-router-dom';
import { ItemStatus } from '@/types';
import { cn } from '@/lib/utils';
import { LostItem, useBulkDeliverLostItems, useBulkCreateLostItems } from '@/hooks/useLostItems';
import { useInfiniteLostItems } from '@/hooks/useInfiniteLostItems';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { DatePickerInput } from '@/components/ui/DatePickerInput';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { generatePdf } from '@/lib/pdfService';
import * as XLSX from 'xlsx';
import type { Database } from '@/integrations/supabase/types';
import { classifyExpiredItem, getDestinationLabel } from '@/lib/expiredItemsDestination';

type CampusEnum = Database['public']['Enums']['campus_enum'];

const statusFilters: { value: ItemStatus | 'all'; label: string; restrictedRoles?: string[] }[] = [
  { value: 'all', label: 'Todos', restrictedRoles: ['admin', 'supervisor'] },
  { value: 'available', label: 'Disponíveis' },
  { value: 'delivered', label: 'Entregues', restrictedRoles: ['admin', 'supervisor'] },
  { value: 'expired', label: 'Expirados', restrictedRoles: ['admin', 'supervisor'] },
];

const campusOptions: CampusEnum[] = ['Campus I', 'Campus II', 'Campus IV', 'Campus HUCM Adm'];

export default function ItemsList() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { role } = useAuth();
  const importFileInputRef = useRef<HTMLInputElement | null>(null);
  const [searchQuery, setSearchQuery] = useState(() => sessionStorage.getItem('lostItems_search') || '');
  const [statusFilter, setStatusFilter] = useState<ItemStatus | 'all'>(() => (sessionStorage.getItem('lostItems_status') as ItemStatus | 'all') || 'available');
  const [campusFilter, setCampusFilter] = useState<CampusEnum | 'all'>(() => (sessionStorage.getItem('lostItems_campus') as CampusEnum | 'all') || 'all');
  const [destinationFilter, setDestinationFilter] = useState<'all' | 'donation' | 'disposal'>(() => (sessionStorage.getItem('lostItems_destination') as 'all' | 'donation' | 'disposal') || 'all');
  const [dateFrom, setDateFrom] = useState(() => sessionStorage.getItem('lostItems_dateFrom') || '');
  const [dateTo, setDateTo] = useState(() => sessionStorage.getItem('lostItems_dateTo') || '');
  
  
  // Filter status options based on user role
  const isAdvancedUser = role === 'admin' || role === 'supervisor';
  const availableStatusFilters = statusFilters.filter(filter => {
    if (!filter.restrictedRoles) return true;
    return filter.restrictedRoles.includes(role || '');
  });
  
  // Selection state
  const [selectedItems, setSelectedItems] = useState<string[]>([]);
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [bulkActionDialog, setBulkActionDialog] = useState<'donation' | 'disposal' | null>(null);
  const [importDialog, setImportDialog] = useState(false);
  const [importData, setImportData] = useState<any[]>([]);
  const [importPreview, setImportPreview] = useState<any[]>([]);
  const [replaceExisting, setReplaceExisting] = useState(false);
  const [bulkImageDialog, setBulkImageDialog] = useState(false);
  const [archiveDeliveredDialog, setArchiveDeliveredDialog] = useState(false);
  const [storageConfigDialog, setStorageConfigDialog] = useState(false);
  const [isMigratingImages, setIsMigratingImages] = useState(false);
  const [isAutoProcessing, setIsAutoProcessing] = useState(false);
  const [autoProcessDialog, setAutoProcessDialog] = useState(false);
  const [autoProcessPreview, setAutoProcessPreview] = useState<{ donation: number; disposal: number; items: any[] }>({ donation: 0, disposal: 0, items: [] });

  const handleMigrateAllImages = async () => {
    setIsMigratingImages(true);
    try {
      const { data, error } = await supabase.functions.invoke('migrate-all-images');
      
      if (error) throw error;
      
      if (data.migrated > 0) {
        toast({
          title: 'Migração concluída!',
          description: `${data.migrated} imagens migradas com sucesso. ${data.failed > 0 ? `${data.failed} falharam.` : ''}`,
        });
        // Force reload to show new URLs
        window.location.reload();
      } else if (data.failed > 0) {
        toast({
          title: 'Erro na migração',
          description: `${data.failed} imagens falharam ao migrar.`,
          variant: 'destructive',
        });
      } else {
        toast({
          title: 'Nenhuma imagem para migrar',
          description: 'Todas as imagens já estão otimizadas.',
        });
      }
    } catch (error: any) {
      toast({
        title: 'Erro',
        description: error.message || 'Falha ao migrar imagens',
        variant: 'destructive',
      });
    } finally {
      setIsMigratingImages(false);
    }
  };

  const { 
    data, 
    isLoading, 
    hasNextPage, 
    isFetchingNextPage, 
    fetchNextPage 
  } = useInfiniteLostItems({
    status: statusFilter === 'all' ? undefined : statusFilter,
    search: searchQuery || undefined,
    campus: campusFilter !== 'all' ? campusFilter : undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    destination: statusFilter === 'all' ? destinationFilter : undefined,
  });

  const bulkDeliver = useBulkDeliverLostItems();
  const bulkCreate = useBulkCreateLostItems();

  // Flatten all pages into a single array
  const filteredItems = useMemo(() => {
    return data?.pages.flatMap(page => page.items) || [];
  }, [data]);

  const totalCount = data?.pages[0]?.totalCount ?? 0;

  // Filter change handlers (no page reset needed with infinite scroll)
  const handleStatusFilterChange = (value: ItemStatus | 'all') => {
    setStatusFilter(value);
    sessionStorage.setItem('lostItems_status', value);
  };

  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    sessionStorage.setItem('lostItems_search', value);
  };

  const handleCampusFilterChange = (value: CampusEnum | 'all') => {
    setCampusFilter(value);
    sessionStorage.setItem('lostItems_campus', value);
  };

  const handleDateFromChange = (value: string) => {
    setDateFrom(value);
    sessionStorage.setItem('lostItems_dateFrom', value);
  };

  const handleDateToChange = (value: string) => {
    setDateTo(value);
    sessionStorage.setItem('lostItems_dateTo', value);
  };

  const handleDestinationFilterChange = (value: 'all' | 'donation' | 'disposal') => {
    setDestinationFilter(value);
    sessionStorage.setItem('lostItems_destination', value);
  };

  // Get expired items for bulk actions
  const expiredItems = useMemo(() => {
    return filteredItems.filter(item => item.status === 'expired');
  }, [filteredItems]);

  const handleItemClick = (item: LostItem) => {
    if (isSelectionMode) {
      toggleItemSelection(item.id);
    } else {
      navigate(`/items/${item.id}`);
    }
  };

  const toggleItemSelection = (id: string) => {
    setSelectedItems(prev => 
      prev.includes(id) 
        ? prev.filter(i => i !== id)
        : [...prev, id]
    );
  };

  const toggleSelectAll = () => {
    if (selectedItems.length === expiredItems.length) {
      setSelectedItems([]);
    } else {
      setSelectedItems(expiredItems.map(i => i.id));
    }
  };

  const handleBulkAction = async (destination: 'donation' | 'disposal') => {
    if (selectedItems.length === 0) return;
    
    await bulkDeliver.mutateAsync({
      ids: selectedItems,
      destination,
    });
    
    setSelectedItems([]);
    setIsSelectionMode(false);
    setBulkActionDialog(null);
  };

  const [isExporting, setIsExporting] = useState(false);

  // Fetch ALL items matching current filters (bypasses pagination)
  const fetchAllFilteredItems = async () => {
    const BATCH_SIZE = 1000;
    const allData: any[] = [];
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      let query = supabase
        .from('lost_items')
        .select('id,code,description,campus,found_location,found_date,received_date,shelf,box,seal_number,delivered_by_name,delivered_by_contact,registered_by,status,owner_name,owner_email,owner_phone,delivered_at,delivered_by_team_member,created_at,updated_at')
        .order('created_at', { ascending: false })
        .range(offset, offset + BATCH_SIZE - 1);

      if (statusFilter && statusFilter !== 'all') {
        query = query.eq('status', statusFilter);
      }
      if (searchQuery) {
        query = query.or(`code.ilike.%${searchQuery}%,description.ilike.%${searchQuery}%,found_location.ilike.%${searchQuery}%`);
      }
      if (campusFilter && campusFilter !== 'all') {
        query = query.eq('campus', campusFilter);
      }
      if (dateFrom) {
        query = query.gte('received_date', dateFrom);
      }
      if (dateTo) {
        query = query.lte('received_date', dateTo);
      }
      if (statusFilter === 'all' && destinationFilter && destinationFilter !== 'all') {
        if (destinationFilter === 'donation') {
          query = query.eq('owner_name', 'DOAÇÃO');
        } else if (destinationFilter === 'disposal') {
          query = query.eq('owner_name', 'DESCARTE');
        }
      }

      const { data, error } = await query;
      if (error) throw error;

      if (data && data.length > 0) {
        allData.push(...data);
        offset += BATCH_SIZE;
        hasMore = data.length === BATCH_SIZE;
      } else {
        hasMore = false;
      }
    }

    return allData;
  };

  const getAppliedFilters = () => {
    const appliedFilters: string[] = [];
    appliedFilters.push(`Status: ${statusFilter === 'all' ? 'Todos' : statusFilters.find(f => f.value === statusFilter)?.label}`);
    if (campusFilter !== 'all') appliedFilters.push(`Campus: ${campusFilter}`);
    if (dateFrom) appliedFilters.push(`De: ${format(new Date(dateFrom), 'dd/MM/yyyy')}`);
    if (dateTo) appliedFilters.push(`Até: ${format(new Date(dateTo), 'dd/MM/yyyy')}`);
    if (statusFilter === 'all' && destinationFilter !== 'all') {
      appliedFilters.push(`Destino: ${destinationFilter === 'donation' ? 'Doação' : 'Descarte'}`);
    }
    return appliedFilters;
  };

  const formatStatus = (status: string) => {
    switch (status) {
      case 'available': return 'Disponível';
      case 'pending': return 'Pendente';
      case 'delivered': return 'Entregue';
      case 'expired': return 'Expirado';
      default: return status;
    }
  };

  const exportToPDF = async () => {
    setIsExporting(true);
    try {
      const allItems = await fetchAllFilteredItems();

      await generatePdf({
        title: 'Relatório de Achados e Perdidos',
        columns: [
          { header: 'Código', accessor: 'code' },
          { header: 'Descrição', accessor: (row: any) => row.description.substring(0, 40) + (row.description.length > 40 ? '...' : '') },
          { header: 'Campus', accessor: 'campus' },
          { header: 'Local', accessor: (row: any) => row.found_location.substring(0, 25) + (row.found_location.length > 25 ? '...' : '') },
          { header: 'Recebido', accessor: (row: any) => format(new Date(row.received_date + 'T00:00:00'), 'dd/MM/yyyy') },
          { header: 'Status', accessor: (row: any) => formatStatus(row.status) },
          { header: 'Prateleira', accessor: (row: any) => row.shelf || '-' },
          { header: 'Caixa', accessor: (row: any) => row.box || '-' },
        ],
        data: allItems,
        filters: getAppliedFilters(),
        filename: 'achados-perdidos',
      });

      toast({
        title: 'PDF gerado',
        description: `${allItems.length} itens exportados com sucesso.`,
      });
    } catch (error: any) {
      toast({
        title: 'Erro ao gerar PDF',
        description: error.message || 'Falha ao exportar o relatório.',
        variant: 'destructive',
      });
    } finally {
      setIsExporting(false);
    }
  };

  const exportToExcel = async () => {
    setIsExporting(true);
    try {
      const allItems = await fetchAllFilteredItems();
      const isExpiredExport = statusFilter === 'expired';

      const excelData = allItems.map((item: any) => {
        const base: Record<string, string> = {
          'Código': item.code || '',
          'Descrição': item.description || '',
          'Campus': item.campus || '',
          'Local Encontrado': item.found_location || '',
          'Data Encontrado': item.found_date ? format(new Date(item.found_date + 'T00:00:00'), 'dd/MM/yyyy') : '',
          'Data Recebido': item.received_date ? format(new Date(item.received_date + 'T00:00:00'), 'dd/MM/yyyy') : '',
          'Status': formatStatus(item.status),
          'Prateleira': item.shelf || '',
          'Caixa': item.box || '',
          'Lacre': item.seal_number || '',
          'Entregue por': item.delivered_by_name || '',
          'Contato': item.delivered_by_contact || '',
        };

        if (isExpiredExport) {
          const dest = classifyExpiredItem(item.description || '');
          base['Destino Sugerido'] = getDestinationLabel(dest);
        } else {
          base['Proprietário'] = item.owner_name || '';
          base['Tel. Proprietário'] = item.owner_phone || '';
          base['Email Proprietário'] = item.owner_email || '';
          base['Data Entrega'] = item.delivered_at ? format(new Date(item.delivered_at), 'dd/MM/yyyy HH:mm') : '';
        }

        return base;
      });

      const worksheet = XLSX.utils.json_to_sheet(excelData);
      const colWidths = isExpiredExport
        ? [
            { wch: 12 }, { wch: 35 }, { wch: 18 }, { wch: 25 },
            { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 10 },
            { wch: 10 }, { wch: 10 }, { wch: 20 }, { wch: 18 },
            { wch: 18 }, // Destino Sugerido
          ]
        : [
            { wch: 12 }, { wch: 35 }, { wch: 18 }, { wch: 25 },
            { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 10 },
            { wch: 10 }, { wch: 10 }, { wch: 20 }, { wch: 18 },
            { wch: 20 }, { wch: 16 }, { wch: 25 }, { wch: 18 },
          ];
      worksheet['!cols'] = colWidths;

      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Achados e Perdidos');
      
      const filename = `achados-perdidos_${format(new Date(), 'yyyy-MM-dd_HH-mm')}.xlsx`;
      XLSX.writeFile(workbook, filename);

      toast({
        title: 'Excel gerado',
        description: `${allItems.length} itens exportados com sucesso.${isExpiredExport ? ' Coluna "Destino Sugerido" incluída.' : ''}`,
      });
    } catch (error: any) {
      toast({
        title: 'Erro ao gerar Excel',
        description: error.message || 'Falha ao exportar o relatório.',
        variant: 'destructive',
      });
    } finally {
      setIsExporting(false);
    }
  };

  // Auto-process expired items: classify all and batch-deliver

  const prepareAutoProcess = async () => {
    setIsAutoProcessing(true);
    try {
      const allExpired = await fetchAllFilteredItems();
      
      let donationCount = 0;
      let disposalCount = 0;
      const classifiedItems = allExpired.map((item: any) => {
        const dest = classifyExpiredItem(item.description || '');
        if (dest === 'donation') donationCount++;
        else disposalCount++;
        return { ...item, autoDestination: dest };
      });

      setAutoProcessPreview({ donation: donationCount, disposal: disposalCount, items: classifiedItems });
      setAutoProcessDialog(true);
    } catch (error: any) {
      toast({
        title: 'Erro',
        description: error.message || 'Falha ao preparar processamento.',
        variant: 'destructive',
      });
    } finally {
      setIsAutoProcessing(false);
    }
  };

  const executeAutoProcess = async () => {
    setIsAutoProcessing(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      
      const donationIds = autoProcessPreview.items
        .filter((i: any) => i.autoDestination === 'donation')
        .map((i: any) => i.id);
      const disposalIds = autoProcessPreview.items
        .filter((i: any) => i.autoDestination === 'disposal')
        .map((i: any) => i.id);

      // Process donations
      if (donationIds.length > 0) {
        const CHUNK = 200;
        for (let i = 0; i < donationIds.length; i += CHUNK) {
          const chunk = donationIds.slice(i, i + CHUNK);
          const { error } = await supabase
            .from('lost_items')
            .update({
              status: 'delivered',
              owner_name: 'DOAÇÃO',
              delivered_at: new Date().toISOString(),
              delivered_by_team_member: user?.id,
            })
            .in('id', chunk);
          if (error) throw error;
        }
      }

      // Process disposals
      if (disposalIds.length > 0) {
        const CHUNK = 200;
        for (let i = 0; i < disposalIds.length; i += CHUNK) {
          const chunk = disposalIds.slice(i, i + CHUNK);
          const { error } = await supabase
            .from('lost_items')
            .update({
              status: 'delivered',
              owner_name: 'DESCARTE',
              delivered_at: new Date().toISOString(),
              delivered_by_team_member: user?.id,
            })
            .in('id', chunk);
          if (error) throw error;
        }
      }

      // Log activity
      const { data: profile } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('user_id', user?.id || '')
        .maybeSingle();

      await supabase.from('activity_logs').insert({
        user_id: user?.id || null,
        user_name: profile?.full_name || user?.email || 'Sistema',
        module: 'lost-items',
        action: 'bulk-auto-deliver',
        entity_id: null,
        entity_description: 'Baixa automática de expirados',
        details: `Processou ${autoProcessPreview.items.length} itens expirados automaticamente (${autoProcessPreview.donation} doação, ${autoProcessPreview.disposal} descarte)`,
      });

      toast({
        title: 'Baixa automática concluída',
        description: `${autoProcessPreview.donation} para doação, ${autoProcessPreview.disposal} para descarte.`,
      });

      setAutoProcessDialog(false);
      setAutoProcessPreview({ donation: 0, disposal: 0, items: [] });
      
      // Refresh data
      window.location.reload();
    } catch (error: any) {
      toast({
        title: 'Erro',
        description: error.message || 'Falha ao processar itens.',
        variant: 'destructive',
      });
    } finally {
      setIsAutoProcessing(false);
    }
  };

  // Helper function to parse dates in various formats (DD/MM/YYYY, YYYY-MM-DD, Date or Excel serial)
  const parseDate = (dateValue: any): string => {
    const today = new Date().toISOString().split('T')[0];

    if (dateValue === undefined || dateValue === null || String(dateValue).trim() === '') {
      return today;
    }

    if (dateValue instanceof Date && !Number.isNaN(dateValue.getTime())) {
      return dateValue.toISOString().split('T')[0];
    }

    if (typeof dateValue === 'string') {
      const trimmed = dateValue.trim();

      // If it's already a valid ISO date string
      if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
        return trimmed.split('T')[0];
      }

      // If it's in DD/MM/YYYY format
      if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(trimmed)) {
        const [day, month, year] = trimmed.split('/');
        return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
      }

      // If it's in DD/MM/YY format
      if (/^\d{1,2}\/\d{1,2}\/\d{2}$/.test(trimmed)) {
        const [day, month, year] = trimmed.split('/');
        return `20${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
      }

      const parsed = new Date(trimmed);
      if (!Number.isNaN(parsed.getTime())) {
        return parsed.toISOString().split('T')[0];
      }
    }

    // If it's an Excel serial date number
    if (typeof dateValue === 'number') {
      const excelEpoch = new Date(1899, 11, 30);
      const date = new Date(excelEpoch.getTime() + dateValue * 24 * 60 * 60 * 1000);
      if (!Number.isNaN(date.getTime())) {
        return date.toISOString().split('T')[0];
      }
    }

    return today;
  };

  const downloadTemplate = () => {
    // Create workbook with example data
    const templateData = [
      {
        codigo_item: '123456',
        descricao: 'Carteira preta de couro',
        campus: 'Campus I',
        local: 'Biblioteca Central',
        data_encontrado: format(new Date(), 'dd/MM/yyyy'),
        data_recebido: format(new Date(), 'dd/MM/yyyy'),
        prateleira: 'A1',
        caixa: 'C01',
        lacre: 'L001',
        entregue_por: 'João Silva',
        contato: '(11) 99999-9999',
        situacao_item: 'Disponível'
      },
      {
        codigo_item: '234567',
        descricao: 'Celular Samsung preto',
        campus: 'Campus II',
        local: 'Cantina',
        data_encontrado: format(new Date(), 'dd/MM/yyyy'),
        data_recebido: format(new Date(), 'dd/MM/yyyy'),
        prateleira: 'B2',
        caixa: 'C02',
        lacre: '',
        entregue_por: 'Maria Santos',
        contato: '',
        situacao_item: 'Disponível'
      },
      {
        codigo_item: '345678',
        descricao: 'Óculos de grau',
        campus: 'Campus IV',
        local: 'Sala 101',
        data_encontrado: format(new Date(), 'dd/MM/yyyy'),
        data_recebido: format(new Date(), 'dd/MM/yyyy'),
        prateleira: '',
        caixa: '',
        lacre: '',
        entregue_por: 'Pedro Oliveira',
        contato: 'pedro@email.com',
        situacao_item: 'Disponível'
      }
    ];

    const worksheet = XLSX.utils.json_to_sheet(templateData);
    
    // Set column widths
    worksheet['!cols'] = [
      { wch: 12 }, // codigo_item
      { wch: 30 }, // descricao
      { wch: 15 }, // campus
      { wch: 20 }, // local
      { wch: 15 }, // data_encontrado
      { wch: 15 }, // data_recebido
      { wch: 12 }, // prateleira
      { wch: 10 }, // caixa
      { wch: 10 }, // lacre
      { wch: 20 }, // entregue_por
      { wch: 18 }, // contato
      { wch: 12 }, // situacao_item
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Modelo');
    
    XLSX.writeFile(workbook, 'modelo-achados-perdidos.xlsx');
    
    toast({
      title: 'Modelo baixado',
      description: 'O arquivo modelo foi baixado com sucesso. Preencha e importe.',
    });
  };

  // Map status from spreadsheet to system status
  const mapStatus = (status: string): string => {
    if (!status) return 'available';
    const normalized = status.toLowerCase().trim();
    if (normalized === 'baixado' || normalized === 'entregue' || normalized === 'delivered') {
      return 'delivered';
    }
    if (normalized === 'expirado' || normalized === 'expired') {
      return 'expired';
    }
    return 'available';
  };

  // Map campus from spreadsheet to valid enum
  const mapCampus = (campus: string): CampusEnum => {
    if (!campus) return 'Campus I';
    const normalized = campus.toLowerCase().trim();
    if (normalized.includes('campus 2') || normalized.includes('campus ii') || normalized === 'campus ii') {
      return 'Campus II';
    }
    if (normalized.includes('campus 4') || normalized.includes('campus iv') || normalized === 'campus iv') {
      return 'Campus IV';
    }
    if (normalized.includes('hucm') || normalized.includes('adm')) {
      return 'Campus HUCM Adm';
    }
    return 'Campus I';
  };

  const normalizeKey = (key: string) => {
    return key
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim()
      .replace(/\s+/g, '_')
      .replace(/[^\w]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '');
  };

  const normalizeRow = (row: Record<string, any>) => {
    const normalized: Record<string, any> = {};

    Object.entries(row).forEach(([key, value]) => {
      normalized[normalizeKey(key)] = value;
    });

    return normalized;
  };

  const getValue = (row: Record<string, any>, keys: string[]) => {
    for (const key of keys) {
      const normalizedKey = normalizeKey(key);
      const value = row[normalizedKey];

      if (value !== undefined && value !== null && String(value).trim() !== '') {
        return value;
      }
    }

    return undefined;
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];

    if (!file) {
      return;
    }

    console.log('[Importar itens] Arquivo selecionado:', {
      name: file.name,
      type: file.type,
      size: file.size,
    });

    const reader = new FileReader();

    reader.onload = (evt) => {
      try {
        const fileData = evt.target?.result;

        if (!fileData) {
          throw new Error('Não foi possível ler o arquivo selecionado.');
        }

        const workbook = XLSX.read(fileData, {
          type: 'array',
          cellDates: true,
        });

        const sheetName = workbook.SheetNames[0];

        if (!sheetName) {
          throw new Error('A planilha não possui nenhuma aba.');
        }

        const worksheet = workbook.Sheets[sheetName];

        const jsonData = XLSX.utils.sheet_to_json<Record<string, any>>(worksheet, {
          defval: '',
        });

        console.log('[Importar itens] Cabeçalhos encontrados:', jsonData[0] ? Object.keys(jsonData[0]) : []);
        console.log('[Importar itens] Quantidade de linhas lidas:', jsonData.length);

        if (!jsonData.length) {
          toast({
            title: 'Nenhum item encontrado',
            description: 'A planilha está vazia ou não possui linhas válidas.',
            variant: 'destructive',
          });
          return;
        }

        const today = new Date().toISOString().split('T')[0];

        const mappedData = jsonData
          .map((originalRow, index) => {
            const row = normalizeRow(originalRow);

            const code =
              getValue(row, ['codigo_item', 'codigo', 'código', 'cod', 'code']) ||
              `AP-${Date.now()}-${index + 1}`;

            const description =
              getValue(row, ['descricao', 'descrição', 'description', 'item', 'objeto']) || '';

            const campus =
              getValue(row, ['campus', 'unidade']) || 'Campus I';

            const foundLocation =
              getValue(row, ['local', 'local_encontrado', 'localização', 'localizacao', 'found_location']) ||
              'Não informado';

            const foundDate =
              getValue(row, ['data_encontrado', 'data_encontrada', 'data', 'found_date']) || today;

            const receivedDate =
              getValue(row, ['data_recebido', 'data_recebida', 'received_date']) || today;

            const deliveredByName =
              getValue(row, ['entregue_por', 'entregue_por_nome', 'recebido_por', 'delivered_by_name']) ||
              'Importação';

            const status =
              getValue(row, ['situacao_item', 'situação_item', 'situacao', 'situação', 'status']) ||
              'available';

            return {
              code: String(code).trim(),
              description: String(description).trim(),
              campus: mapCampus(String(campus)),
              found_location: String(foundLocation).trim(),
              found_date: parseDate(foundDate),
              received_date: parseDate(receivedDate),
              shelf: getValue(row, ['prateleira', 'shelf']) || null,
              box: getValue(row, ['caixa', 'box']) || null,
              seal_number: getValue(row, ['lacre', 'seal_number']) || null,
              delivered_by_name: String(deliveredByName).trim(),
              delivered_by_contact: getValue(row, ['contato', 'telefone', 'delivered_by_contact']) || null,
              status: mapStatus(String(status)),
            };
          })
          .filter((item) => item.code && item.description);

        console.log('[Importar itens] Dados convertidos para importação:', mappedData);

        if (!mappedData.length) {
          toast({
            title: 'Nenhum item válido',
            description: 'Verifique se a planilha possui pelo menos código e descrição.',
            variant: 'destructive',
          });
          return;
        }

        setImportData(mappedData);
        setImportPreview(mappedData.slice(0, 5));
        setImportDialog(true);

        toast({
          title: 'Planilha carregada',
          description: `${mappedData.length} item(ns) encontrado(s). Confira a prévia antes de importar.`,
        });
      } catch (error: any) {
        console.error('[Importar itens] Erro ao processar planilha:', error);

        toast({
          title: 'Erro ao ler planilha',
          description: error.message || 'Não foi possível processar o arquivo selecionado.',
          variant: 'destructive',
        });
      } finally {
        e.target.value = '';
      }
    };

    reader.onerror = () => {
      console.error('[Importar itens] Erro no FileReader:', reader.error);

      toast({
        title: 'Erro ao abrir arquivo',
        description: 'Não foi possível abrir o arquivo selecionado.',
        variant: 'destructive',
      });

      e.target.value = '';
    };

    reader.readAsArrayBuffer(file);
  };

  const handleImport = async () => {
    if (importData.length === 0) {
      toast({
        title: 'Nenhum item para importar',
        description: 'Selecione uma planilha válida antes de importar.',
        variant: 'destructive',
      });
      return;
    }

    try {
      console.log('[Importar itens] Enviando itens para o Supabase:', importData);
      await bulkCreate.mutateAsync({ items: importData, replaceExisting });

      toast({
        title: 'Importação concluída',
        description: `${importData.length} item(ns) importado(s) com sucesso.`,
      });

      setImportDialog(false);
      setImportData([]);
      setImportPreview([]);
      setReplaceExisting(false);
    } catch (error: any) {
      console.error('[Importar itens] Erro ao importar itens:', error);

      toast({
        title: 'Erro ao importar itens',
        description: error.message || 'Não foi possível importar os itens da planilha.',
        variant: 'destructive',
      });
    }
  };

  return (
    <MainLayout>
      <div className="page-header">
        <h1 className="page-title">Buscar Itens</h1>
        <p className="page-subtitle">Pesquise e visualize os itens cadastrados</p>
      </div>

      {/* Search and Filters */}
      <div className="mb-6 space-y-4">
        <div className="flex flex-wrap gap-4">
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
            <Input
              placeholder="Buscar por código, descrição ou local..."
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="pl-10"
            />
          </div>
          
          <Select value={campusFilter} onValueChange={(v) => handleCampusFilterChange(v as CampusEnum | 'all')}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="Campus" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos Campus</SelectItem>
              {campusOptions.map(campus => (
                <SelectItem key={campus} value={campus}>{campus}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="flex gap-2 items-center">
            <DatePickerInput
              value={dateFrom}
              onChange={handleDateFromChange}
              placeholder="De"
              className="w-[130px]"
            />
            <span className="text-muted-foreground">-</span>
            <DatePickerInput
              value={dateTo}
              onChange={handleDateToChange}
              placeholder="Até"
              className="w-[130px]"
            />
          </div>

          {/* Clear Filters Button */}
          {(searchQuery || campusFilter !== 'all' || statusFilter !== 'available' || destinationFilter !== 'all' || dateFrom || dateTo) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearchQuery('');
                setCampusFilter('all');
                setStatusFilter('available');
                setDestinationFilter('all');
                setDateFrom('');
                setDateTo('');
                sessionStorage.removeItem('lostItems_search');
                sessionStorage.removeItem('lostItems_status');
                sessionStorage.removeItem('lostItems_campus');
                sessionStorage.removeItem('lostItems_destination');
                sessionStorage.removeItem('lostItems_dateFrom');
                sessionStorage.removeItem('lostItems_dateTo');
              }}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="w-4 h-4 mr-1" />
              Limpar Filtros
            </Button>
          )}
        </div>

        {/* Status Filter */}
        <div className="flex flex-wrap gap-2">
          {availableStatusFilters.map((filter) => (
            <Button
              key={filter.value}
              variant={statusFilter === filter.value ? 'default' : 'outline'}
              size="sm"
              onClick={() => handleStatusFilterChange(filter.value)}
              className={cn(
                'transition-all',
                statusFilter === filter.value && 'shadow-md'
              )}
            >
              {filter.label}
            </Button>
          ))}
        </div>

        {/* Destination Filter (for "Todos" status) - admin/supervisor only */}
        {isAdvancedUser && statusFilter === 'all' && (
          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-sm text-muted-foreground">Destino:</span>
            <Button
              variant={destinationFilter === 'all' ? 'default' : 'outline'}
              size="sm"
              onClick={() => handleDestinationFilterChange('all')}
            >
              Todos
            </Button>
            <Button
              variant={destinationFilter === 'donation' ? 'default' : 'outline'}
              size="sm"
              onClick={() => handleDestinationFilterChange('donation')}
              className="gap-1"
            >
              <Gift className="w-4 h-4" />
              Doação
            </Button>
            <Button
              variant={destinationFilter === 'disposal' ? 'default' : 'outline'}
              size="sm"
              onClick={() => handleDestinationFilterChange('disposal')}
              className="gap-1"
            >
              <Trash2 className="w-4 h-4" />
              Descarte
            </Button>
          </div>
        )}

        {isAdvancedUser && (
        <div className="flex flex-wrap gap-2 items-center">
          {/* Export/Import Dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <FileDown className="w-4 h-4 mr-2" />
                Exportar/Importar
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="bg-popover border shadow-md z-50">
              <DropdownMenuItem onClick={exportToExcel} disabled={isExporting || filteredItems.length === 0}>
                <FileSpreadsheet className="w-4 h-4 mr-2" />
                {isExporting ? 'Exportando...' : 'Exportar Excel'}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={exportToPDF} disabled={isExporting || filteredItems.length === 0}>
                <FileDown className="w-4 h-4 mr-2" />
                {isExporting ? 'Exportando...' : 'Exportar PDF'}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={downloadTemplate}>
                <FileSpreadsheet className="w-4 h-4 mr-2" />
                Baixar Modelo Excel
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={(event) => {
                  event.preventDefault();
                  setTimeout(() => {
                    importFileInputRef.current?.click();
                  }, 0);
                }}
              >
                <Upload className="w-4 h-4 mr-2" />
                Importar Itens
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setBulkImageDialog(true)}>
                <ImageIcon className="w-4 h-4 mr-2" />
                Upload Imagens em Lote
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <input
            ref={importFileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={handleFileUpload}
          />

          {/* Admin Actions Dropdown */}
          {role === 'admin' && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <Settings2 className="w-4 h-4 mr-2" />
                  Ações Admin
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="bg-popover border shadow-md z-50">
                <DropdownMenuItem 
                  onClick={handleMigrateAllImages}
                  disabled={isMigratingImages}
                >
                  {isMigratingImages ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Zap className="w-4 h-4 mr-2" />
                  )}
                  Otimizar Imagens
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => navigate('/lost-found/archived')}>
                  <Archive className="w-4 h-4 mr-2" />
                  Ver Arquivados
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setArchiveDeliveredDialog(true)}>
                  <Archive className="w-4 h-4 mr-2" />
                  Arquivar Entregues
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setStorageConfigDialog(true)}>
                  <Package className="w-4 h-4 mr-2" />
                  Configurar Prateleiras/Caixas
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {/* Expired Items Selection Mode */}
          {statusFilter === 'expired' && expiredItems.length > 0 && (
            <>
              <Button
                variant="default"
                size="sm"
                onClick={prepareAutoProcess}
                disabled={isAutoProcessing}
                className="gap-2"
              >
                {isAutoProcessing ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Zap className="w-4 h-4" />
                )}
                Baixa Automática
              </Button>
              {isSelectionMode ? (
                <>
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={() => {
                      setIsSelectionMode(false);
                      setSelectedItems([]);
                    }}
                  >
                    <X className="w-4 h-4 mr-2" />
                    Cancelar
                  </Button>
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={toggleSelectAll}
                  >
                    <CheckSquare className="w-4 h-4 mr-2" />
                    {selectedItems.length === expiredItems.length ? 'Desmarcar' : 'Selecionar'} Todos
                  </Button>
                  {selectedItems.length > 0 && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button size="sm" variant="secondary">
                          <MoreHorizontal className="w-4 h-4 mr-2" />
                          Ações ({selectedItems.length})
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="bg-popover border shadow-md z-50">
                        <DropdownMenuItem onClick={() => setBulkActionDialog('donation')}>
                          <Gift className="w-4 h-4 mr-2" />
                          Enviar para Doação
                        </DropdownMenuItem>
                        <DropdownMenuItem 
                          onClick={() => setBulkActionDialog('disposal')}
                          className="text-destructive focus:text-destructive"
                        >
                          <Trash2 className="w-4 h-4 mr-2" />
                          Enviar para Descarte
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </>
              ) : (
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => setIsSelectionMode(true)}
                >
                  <CheckSquare className="w-4 h-4 mr-2" />
                  Selecionar Itens
                </Button>
              )}
            </>
          )}
        </div>
        )}
      </div>

      {/* Results */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      ) : !filteredItems || filteredItems.length === 0 ? (
        <div className="text-center py-16">
          <Package className="w-16 h-16 mx-auto text-muted-foreground/50 mb-4" />
          <h3 className="text-lg font-medium text-foreground">Nenhum item encontrado</h3>
          <p className="text-muted-foreground mt-1">
            Tente ajustar os filtros ou termo de busca
          </p>
        </div>
      ) : (
        <>
          <p className="text-sm text-muted-foreground mb-4">
            {totalCount} {totalCount === 1 ? 'item encontrado' : 'itens encontrados'}
            {isSelectionMode && ` | ${selectedItems.length} selecionado(s)`}
          </p>
          <VirtualizedItemsList
            items={filteredItems}
            isSelectionMode={isSelectionMode}
            selectedItems={selectedItems}
            onItemClick={handleItemClick}
            onToggleSelection={toggleItemSelection}
            hasNextPage={hasNextPage}
            isFetchingNextPage={isFetchingNextPage}
            fetchNextPage={fetchNextPage}
          />
      </>
    )}

      {/* Bulk Action Confirmation Dialog */}
      <Dialog open={!!bulkActionDialog} onOpenChange={() => setBulkActionDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {bulkActionDialog === 'donation' ? 'Confirmar Doação' : 'Confirmar Descarte'}
            </DialogTitle>
            <DialogDescription>
              {selectedItems.length} item(ns) será(ão) marcado(s) como {bulkActionDialog === 'donation' ? 'doado(s)' : 'descartado(s)'}.
              Esta ação não pode ser desfeita.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkActionDialog(null)}>
              Cancelar
            </Button>
            <Button 
              variant={bulkActionDialog === 'disposal' ? 'destructive' : 'default'}
              onClick={() => handleBulkAction(bulkActionDialog!)}
              disabled={bulkDeliver.isPending}
            >
              {bulkDeliver.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : bulkActionDialog === 'donation' ? (
                <Gift className="w-4 h-4 mr-2" />
              ) : (
                <Trash2 className="w-4 h-4 mr-2" />
              )}
              Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Import Dialog */}
      <Dialog open={importDialog} onOpenChange={setImportDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Importar Itens</DialogTitle>
            <DialogDescription>
              {importData.length} item(ns) encontrado(s) no arquivo. Confira a prévia abaixo.
            </DialogDescription>
          </DialogHeader>
          
          <div className="max-h-[300px] overflow-auto border rounded-lg">
            <table className="w-full text-sm">
              <thead className="bg-muted sticky top-0">
                <tr>
                  <th className="p-2 text-left">Código</th>
                  <th className="p-2 text-left">Descrição</th>
                  <th className="p-2 text-left">Campus</th>
                  <th className="p-2 text-left">Local</th>
                </tr>
              </thead>
              <tbody>
                {importPreview.map((item, idx) => (
                  <tr key={idx} className="border-t">
                    <td className="p-2 font-mono text-xs">{item.code}</td>
                    <td className="p-2 truncate max-w-[200px]">{item.description}</td>
                    <td className="p-2">{item.campus}</td>
                    <td className="p-2 truncate max-w-[150px]">{item.found_location}</td>
                  </tr>
                ))}
                {importData.length > 5 && (
                  <tr className="border-t bg-muted/50">
                    <td colSpan={4} className="p-2 text-center text-muted-foreground">
                      ... e mais {importData.length - 5} item(ns)
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          
          <div className="flex items-center space-x-2 p-3 bg-muted/50 rounded-lg">
            <Checkbox 
              id="replaceExisting" 
              checked={replaceExisting}
              onCheckedChange={(checked) => setReplaceExisting(checked === true)}
            />
            <Label htmlFor="replaceExisting" className="text-sm cursor-pointer">
              Substituir itens existentes com mesmo código (duplicados serão atualizados)
            </Label>
          </div>
          
          <p className="text-xs text-muted-foreground">
            O arquivo deve conter colunas como: codigo, descricao, campus, local, data_encontrado, data_recebido, prateleira, caixa, lacre, entregue_por
          </p>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportDialog(false)}>
              Cancelar
            </Button>
            <Button onClick={handleImport} disabled={bulkCreate.isPending || importData.length === 0}>
              {bulkCreate.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Importar {importData.length} Item(ns)
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <BulkImageUploadDialog 
        open={bulkImageDialog} 
        onOpenChange={setBulkImageDialog} 
      />

      <ArchiveDeliveredItemsDialog
        open={archiveDeliveredDialog}
        onOpenChange={setArchiveDeliveredDialog}
      />

      <StorageConfigDialog
        open={storageConfigDialog}
        onOpenChange={setStorageConfigDialog}
      />

      {/* Auto-Process Expired Items Dialog */}
      <Dialog open={autoProcessDialog} onOpenChange={setAutoProcessDialog}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Zap className="w-5 h-5 text-primary" />
              Baixa Automática de Expirados
            </DialogTitle>
            <DialogDescription>
              Os itens expirados serão classificados automaticamente com base na descrição.
            </DialogDescription>
          </DialogHeader>
          
          <div className="py-4 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 rounded-lg border bg-green-500/10 border-green-500/20 text-center">
                <Gift className="w-6 h-6 mx-auto mb-2 text-green-600" />
                <p className="text-2xl font-bold text-green-600">{autoProcessPreview.donation}</p>
                <p className="text-sm text-muted-foreground">Doação</p>
                <p className="text-xs text-muted-foreground mt-1">Roupas, mochilas, objetos comuns</p>
              </div>
              <div className="p-4 rounded-lg border bg-red-500/10 border-red-500/20 text-center">
                <Trash2 className="w-6 h-6 mx-auto mb-2 text-red-600" />
                <p className="text-2xl font-bold text-red-600">{autoProcessPreview.disposal}</p>
                <p className="text-sm text-muted-foreground">Descarte</p>
                <p className="text-xs text-muted-foreground mt-1">Higiene, documentos, chaves</p>
              </div>
            </div>

            <p className="text-sm text-muted-foreground">
              Total: <strong>{autoProcessPreview.items.length}</strong> itens serão processados. 
              A classificação é feita com base em palavras-chave da descrição do item.
            </p>

            {autoProcessPreview.items.length > 0 && (
              <div className="max-h-[200px] overflow-auto border rounded-lg">
                <table className="w-full text-xs">
                  <thead className="bg-muted sticky top-0">
                    <tr>
                      <th className="p-2 text-left">Código</th>
                      <th className="p-2 text-left">Descrição</th>
                      <th className="p-2 text-left">Destino</th>
                    </tr>
                  </thead>
                  <tbody>
                    {autoProcessPreview.items.slice(0, 20).map((item: any) => (
                      <tr key={item.id} className="border-t">
                        <td className="p-2 font-mono">{item.code}</td>
                        <td className="p-2 truncate max-w-[200px]">{item.description}</td>
                        <td className="p-2">
                          <span className={cn(
                            "px-2 py-0.5 rounded text-xs font-medium",
                            item.autoDestination === 'donation' 
                              ? "bg-green-500/10 text-green-700" 
                              : "bg-red-500/10 text-red-700"
                          )}>
                            {item.autoDestination === 'donation' ? 'Doação' : 'Descarte'}
                          </span>
                        </td>
                      </tr>
                    ))}
                    {autoProcessPreview.items.length > 20 && (
                      <tr className="border-t bg-muted/50">
                        <td colSpan={3} className="p-2 text-center text-muted-foreground">
                          ... e mais {autoProcessPreview.items.length - 20} item(ns)
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setAutoProcessDialog(false)} disabled={isAutoProcessing}>
              Cancelar
            </Button>
            <Button 
              onClick={executeAutoProcess} 
              disabled={isAutoProcessing || autoProcessPreview.items.length === 0}
            >
              {isAutoProcessing ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Zap className="w-4 h-4 mr-2" />
              )}
              Confirmar Baixa ({autoProcessPreview.items.length})
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
}
