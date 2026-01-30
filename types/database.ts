// =====================================================
// PARTEA 1: ENUMS ȘI TIPURI DE BAZĂ
// =====================================================

export type UserRole = 'admin' | 'consultant' | 'client';

export type ProjectStatus = 
  | 'pregatire' | 'depunere' | 'evaluare' | 'contractare' 
  | 'implementare' | 'rambursare' | 'monitorizare' | 'finalizat' | 'arhivat';

export type PhaseStatus = 'pending' | 'in_progress' | 'completed' | 'skipped';

export type ActivityStatus = 'pending' | 'in_progress' | 'completed' | 'skipped' | 'blocked';

export type SessionStatus = 'upcoming' | 'open' | 'closed' | 'evaluation' | 'completed';

export type DocumentRequirementStatus = 'pending' | 'uploaded' | 'review' | 'approved' | 'rejected';

export type FileReviewStatus = 'pending' | 'approved' | 'rejected';

export type AuditActionType = 'create' | 'update' | 'delete' | 'login' | 'logout';

export type AuditEntityType = 'project' | 'document' | 'user' | 'file' | 'team_member' | 'phase' | 'activity';

export type NotificationType = 
  | 'document_requested' | 'document_uploaded' | 'document_approved' | 'document_rejected'
  | 'project_status_changed' | 'project_created'
  | 'team_added' | 'team_removed'
  | 'deadline_approaching' | 'phase_completed' | 'activity_completed' | 'mention';


// =====================================================
// PARTEA 2: INTERFEȚE PRINCIPALE
// =====================================================

// PROFILE
export interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  role: UserRole;
  cui_firma: string | null;
  cif: string | null;
  adresa_firma: string | null;
  telefon: string | null;
  persoana_contact: string | null;
  departament: string | null;
  specializare: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ProfileCreate {
  email: string;
  full_name?: string;
  role?: UserRole;
  cui_firma?: string;
  telefon?: string;
}

export interface ProfileUpdate extends Partial<ProfileCreate> {
  cif?: string;
  adresa_firma?: string;
  persoana_contact?: string;
  departament?: string;
  specializare?: string;
  is_active?: boolean;
}

// PROGRAM
export interface Program {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  official_url: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ProgramOverview extends Program {
  total_measures: number;
  total_projects: number;
}

export interface ProgramCreate {
  name: string;
  slug: string;
  description?: string;
  official_url?: string;
}

// MĂSURĂ
export interface ProgramMeasure {
  id: string;
  program_id: string;
  name: string;
  slug: string;
  code: string | null;
  description: string | null;
  max_funding_amount: number | null;
  min_funding_amount: number | null;
  co_financing_percent: number | null;
  currency: string;
  eligible_applicants: string | null;
  eligible_regions: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface MeasureOverview extends ProgramMeasure {
  program_name: string;
  program_slug: string;
  total_sessions: number;
  open_sessions: number;
  total_projects: number;
}

export interface MeasureCreate {
  program_id: string;
  name: string;
  slug: string;
  code?: string;
  description?: string;
  max_funding_amount?: number;
  min_funding_amount?: number;
  co_financing_percent?: number;
  eligible_applicants?: string;
}

// SESIUNE
export interface MeasureSession {
  id: string;
  measure_id: string;
  name: string;
  code: string | null;
  description: string | null;
  submission_start_date: string | null;
  submission_end_date: string | null;
  total_budget: number | null;
  remaining_budget: number | null;
  status: SessionStatus;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface SessionOverview extends MeasureSession {
  measure_name: string;
  measure_slug: string;
  max_funding_amount: number | null;
  co_financing_percent: number | null;
  program_name: string;
  program_slug: string;
  total_projects: number;
  days_remaining: number | null;
}

export interface SessionCreate {
  measure_id: string;
  name: string;
  code?: string;
  description?: string;
  submission_start_date?: string;
  submission_end_date?: string;
  total_budget?: number;
}

// PROIECT
export interface Project {
  id: string;
  title: string;
  client_id: string;
  status: string;
  progress: number;
  program_id: string | null;
  measure_id: string | null;
  session_id: string | null;
  cod_proiect: string | null;
  cod_intern: string;
  telefon_contact: string | null;
  email_contact: string | null;
  persoana_contact: string | null;
  is_preluat: boolean;
  preluat_detalii: string | null;
  created_at: string;
  updated_at: string;
  profiles?: Profile;
  program?: Program;
  measure?: ProgramMeasure;
  session?: MeasureSession;
}

export interface ProjectCreate {
  title: string;
  client_id: string;
  program_id?: string;
  measure_id?: string;
  session_id?: string;
  cod_proiect?: string;
  telefon_contact?: string;
  email_contact?: string;
  persoana_contact?: string;
  is_preluat?: boolean;
  preluat_detalii?: string;
}

export interface ProjectUpdate extends Partial<ProjectCreate> {
  status?: string;
  progress?: number;
}

// TEMPLATE FAZE
export interface MeasurePhaseTemplate {
  id: string;
  measure_id: string;
  name: string;
  slug: string;
  description: string | null;
  order_index: number;
  estimated_days: number | null;
  is_active: boolean;
  created_at: string;
  activities?: MeasureActivityTemplate[];
}

// TEMPLATE ACTIVITĂȚI
export interface MeasureActivityTemplate {
  id: string;
  phase_template_id: string;
  name: string;
  description: string | null;
  order_index: number;
  estimated_days: number | null;
  required_documents: RequiredDocument[];
  is_active: boolean;
  created_at: string;
}

export interface RequiredDocument {
  name: string;
  mandatory: boolean;
  description?: string;
}

// FAZĂ PROIECT
export interface ProjectPhase {
  id: string;
  project_id: string;
  name: string;
  slug: string;
  description: string | null;
  order_index: number;
  status: PhaseStatus;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  activities?: ProjectActivity[];
}

// ACTIVITATE PROIECT
export interface ProjectActivity {
  id: string;
  phase_id: string;
  name: string;
  description: string | null;
  order_index: number;
  status: ActivityStatus;
  assigned_to: string | null;
  deadline_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  assigned_user?: { id: string; full_name: string | null; email: string };
  document_requirements?: ActivityDocumentRequirement[];
}

export interface ProjectActivityUpdate {
  name?: string;
  description?: string;
  status?: ActivityStatus;
  assigned_to?: string | null;
  deadline_at?: string | null;
  notes?: string;
}

// CERINȚĂ DOCUMENT
export interface ActivityDocumentRequirement {
  id: string;
  activity_id: string;
  name: string;
  description: string | null;
  is_mandatory: boolean;
  template_path: string | null;
  template_name: string | null;
  deadline_at: string | null;
  status: DocumentRequirementStatus;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  files?: ActivityDocumentFile[];
}

export interface ActivityDocumentRequirementCreate {
  activity_id: string;
  name: string;
  description?: string;
  is_mandatory?: boolean;
  template_path?: string;
  template_name?: string;
  deadline_at?: string;
}

// FIȘIER DOCUMENT
export interface ActivityDocumentFile {
  id: string;
  requirement_id: string;
  storage_path: string;
  original_name: string;
  file_size: number | null;
  mime_type: string | null;
  version_number: number;
  review_status: FileReviewStatus;
  review_notes: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  uploaded_by: string;
  uploaded_at: string;
  uploader?: { full_name: string | null; email: string };
  reviewer?: { full_name: string | null; email: string };
}

export interface ActivityDocumentFileCreate {
  requirement_id: string;
  storage_path: string;
  original_name: string;
  file_size?: number;
  mime_type?: string;
}

export interface ActivityDocumentFileReview {
  review_status: FileReviewStatus;
  review_notes?: string;
}

// AUDIT LOG
export interface AuditLog {
  id: string;
  user_id: string | null;
  action_type: AuditActionType;
  entity_type: AuditEntityType;
  entity_id: string | null;
  entity_name: string | null;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  description: string | null;
  ip_address: string | null;
  created_at: string;
  user?: { email: string; full_name: string | null };
}

// NOTIFICARE
export interface Notification {
  id: string;
  user_id: string;
  type: NotificationType;
  title: string;
  message: string | null;
  entity_type: 'project' | 'document' | 'user' | 'phase' | 'activity' | null;
  entity_id: string | null;
  is_read: boolean;
  created_at: string;
}

export interface NotificationCreate {
  user_id: string;
  type: NotificationType;
  title: string;
  message?: string;
  entity_type?: string;
  entity_id?: string;
}


// =====================================================
// PARTEA 3: VIEWS ȘI TIPURI AGREGATE
// =====================================================

export interface FundingHierarchy {
  program_id: string;
  program_name: string;
  program_slug: string;
  measure_id: string | null;
  measure_name: string | null;
  measure_slug: string | null;
  measure_code: string | null;
  max_funding_amount: number | null;
  co_financing_percent: number | null;
  session_id: string | null;
  session_name: string | null;
  session_code: string | null;
  session_status: SessionStatus | null;
  submission_start_date: string | null;
  submission_end_date: string | null;
}

export interface ProjectProgress {
  project_id: string;
  title: string;
  status: string;
  cod_intern: string;
  program_name: string | null;
  measure_name: string | null;
  session_name: string | null;
  current_phase_name: string | null;
  current_phase_slug: string | null;
  total_phases: number;
  completed_phases: number;
  progress_percent: number;
}

export interface ActivityDocumentsStatus {
  activity_id: string;
  activity_name: string;
  activity_status: string;
  phase_id: string;
  phase_name: string;
  project_id: string;
  total_required: number;
  mandatory_required: number;
  approved_count: number;
  pending_count: number;
  review_count: number;
  rejected_count: number;
  document_progress_percent: number;
  all_mandatory_approved: boolean;
}

export interface ProjectActivityComplete {
  activity_id: string;
  phase_id: string;
  activity_name: string;
  activity_description: string | null;
  activity_order: number;
  activity_status: string;
  assigned_to: string | null;
  activity_deadline: string | null;
  activity_notes: string | null;
  phase_name: string;
  phase_slug: string;
  project_id: string;
  project_title: string;
  cod_intern: string;
  assigned_name: string | null;
  assigned_email: string | null;
  total_documents: number;
  approved_documents: number;
  pending_documents: number;
  can_complete: boolean;
}

export interface UpcomingDeadline {
  activity_id: string;
  activity_name: string;
  phase_name: string;
  project_id: string;
  project_title: string;
  cod_intern: string;
  deadline_at: string;
  days_remaining: number;
  status: string;
  assigned_to: string | null;
  assigned_name: string | null;
}


// =====================================================
// PARTEA 4: CONFIG-URI UI
// =====================================================

export interface StatusConfig {
  bg: string;
  text: string;
  border: string;
  dot?: string;
  icon?: string;
  label: string;
}

export const SESSION_STATUS_CONFIG: Record<SessionStatus, StatusConfig> = {
  upcoming: { bg: 'bg-slate-100', text: 'text-slate-600', border: 'border-slate-200', dot: 'bg-slate-400', icon: 'Clock', label: 'În curând' },
  open: { bg: 'bg-emerald-100', text: 'text-emerald-700', border: 'border-emerald-200', dot: 'bg-emerald-500', icon: 'CheckCircle', label: 'Deschis' },
  closed: { bg: 'bg-amber-100', text: 'text-amber-700', border: 'border-amber-200', dot: 'bg-amber-500', icon: 'XCircle', label: 'Închis' },
  evaluation: { bg: 'bg-blue-100', text: 'text-blue-700', border: 'border-blue-200', dot: 'bg-blue-500', icon: 'Search', label: 'În evaluare' },
  completed: { bg: 'bg-gray-100', text: 'text-gray-600', border: 'border-gray-200', dot: 'bg-gray-400', icon: 'Archive', label: 'Finalizat' }
};

export const PHASE_STATUS_CONFIG: Record<PhaseStatus, StatusConfig> = {
  pending: { bg: 'bg-slate-100', text: 'text-slate-600', border: 'border-slate-200', dot: 'bg-slate-400', icon: 'Circle', label: 'În așteptare' },
  in_progress: { bg: 'bg-indigo-100', text: 'text-indigo-700', border: 'border-indigo-200', dot: 'bg-indigo-500', icon: 'PlayCircle', label: 'În desfășurare' },
  completed: { bg: 'bg-emerald-100', text: 'text-emerald-700', border: 'border-emerald-200', dot: 'bg-emerald-500', icon: 'CheckCircle', label: 'Finalizat' },
  skipped: { bg: 'bg-gray-100', text: 'text-gray-500', border: 'border-gray-200', dot: 'bg-gray-400', icon: 'SkipForward', label: 'Sărit' }
};

export const ACTIVITY_STATUS_CONFIG: Record<ActivityStatus, StatusConfig> = {
  pending: { bg: 'bg-slate-50', text: 'text-slate-600', border: 'border-slate-200', icon: 'Circle', label: 'De făcut' },
  in_progress: { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200', icon: 'Clock', label: 'În lucru' },
  completed: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', icon: 'CheckCircle2', label: 'Gata' },
  skipped: { bg: 'bg-gray-50', text: 'text-gray-500', border: 'border-gray-200', icon: 'SkipForward', label: 'Sărit' },
  blocked: { bg: 'bg-red-50', text: 'text-red-600', border: 'border-red-200', icon: 'AlertCircle', label: 'Blocat' }
};

export const DOCUMENT_STATUS_CONFIG: Record<DocumentRequirementStatus, StatusConfig> = {
  pending: { bg: 'bg-slate-50', text: 'text-slate-600', border: 'border-slate-200', icon: 'FileQuestion', label: 'Așteaptă document' },
  uploaded: { bg: 'bg-blue-50', text: 'text-blue-600', border: 'border-blue-200', icon: 'FileUp', label: 'Încărcat' },
  review: { bg: 'bg-amber-50', text: 'text-amber-600', border: 'border-amber-200', icon: 'FileSearch', label: 'În verificare' },
  approved: { bg: 'bg-emerald-50', text: 'text-emerald-600', border: 'border-emerald-200', icon: 'FileCheck', label: 'Aprobat' },
  rejected: { bg: 'bg-red-50', text: 'text-red-600', border: 'border-red-200', icon: 'FileX', label: 'Respins' }
};

export const PROGRAM_COLORS: Record<string, string> = {
  'pnrr': 'bg-blue-500',
  'poc': 'bg-purple-500',
  'pocu': 'bg-teal-500',
  'startup-nation': 'bg-orange-500',
  'pndr': 'bg-green-500',
  'default': 'bg-slate-500'
};


// =====================================================
// PARTEA 5: FUNCȚII HELPER
// =====================================================

export function formatAmount(amount: number | null, currency: string = 'EUR'): string {
  if (!amount) return 'N/A';
  return new Intl.NumberFormat('ro-RO', { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount);
}

export function formatDate(date: string | null): string {
  if (!date) return 'N/A';
  return new Date(date).toLocaleDateString('ro-RO', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatPeriod(startDate: string | null, endDate: string | null): string {
  if (!startDate && !endDate) return 'Nedefinită';
  if (startDate && endDate) return `${formatDate(startDate)} - ${formatDate(endDate)}`;
  if (startDate) return `Din ${formatDate(startDate)}`;
  return `Până la ${formatDate(endDate)}`;
}

export function getDaysRemaining(date: string | null): number | null {
  if (!date) return null;
  const target = new Date(date);
  const now = new Date();
  return Math.ceil((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

export function getDaysRemainingColor(days: number | null): string {
  if (days === null) return 'text-slate-500';
  if (days < 0) return 'text-red-600 font-semibold';
  if (days <= 3) return 'text-orange-600 font-medium';
  if (days <= 7) return 'text-amber-600';
  return 'text-slate-600';
}

export function formatFileSize(bytes: number | null): string {
  if (!bytes) return 'N/A';
  const units = ['B', 'KB', 'MB', 'GB'];
  let unitIndex = 0;
  let size = bytes;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  return `${size.toFixed(1)} ${units[unitIndex]}`;
}

export function getFileExtension(filename: string): string {
  return filename.split('.').pop()?.toLowerCase() || '';
}

export function getFileIcon(mimeType: string | null, filename: string): string {
  const ext = getFileExtension(filename);
  if (mimeType?.startsWith('image/')) return 'Image';
  if (mimeType === 'application/pdf' || ext === 'pdf') return 'FileText';
  if (mimeType?.includes('spreadsheet') || ['xlsx', 'xls', 'csv'].includes(ext)) return 'FileSpreadsheet';
  if (mimeType?.includes('document') || ['doc', 'docx'].includes(ext)) return 'FileText';
  return 'File';
}

export function calculateDocumentProgress(requirements: ActivityDocumentRequirement[]): {
  total: number; approved: number; pending: number; rejected: number; percent: number; allMandatoryApproved: boolean;
} {
  const total = requirements.length;
  const approved = requirements.filter(r => r.status === 'approved').length;
  const pending = requirements.filter(r => r.status === 'pending').length;
  const rejected = requirements.filter(r => r.status === 'rejected').length;
  const mandatory = requirements.filter(r => r.is_mandatory);
  const mandatoryApproved = mandatory.filter(r => r.status === 'approved').length;
  return {
    total, approved, pending, rejected,
    percent: total > 0 ? Math.round((approved / total) * 100) : 100,
    allMandatoryApproved: mandatory.length === 0 || mandatoryApproved === mandatory.length
  };
}

export function getPhaseStepperColors(status: PhaseStatus): { circle: string; line: string; text: string } {
  switch (status) {
    case 'completed': return { circle: 'bg-emerald-500 border-emerald-500 text-white', line: 'bg-emerald-500', text: 'text-emerald-700' };
    case 'in_progress': return { circle: 'bg-indigo-500 border-indigo-500 text-white ring-4 ring-indigo-100', line: 'bg-slate-200', text: 'text-indigo-700 font-semibold' };
    case 'skipped': return { circle: 'bg-gray-300 border-gray-300 text-gray-500', line: 'bg-gray-300', text: 'text-gray-400 line-through' };
    default: return { circle: 'bg-white border-slate-300 text-slate-400', line: 'bg-slate-200', text: 'text-slate-500' };
  }
}


// =====================================================
// PARTEA 6: SUPABASE DATABASE TYPES
// =====================================================

export interface Database {
  public: {
    Tables: {
      profiles: { Row: Profile; Insert: ProfileCreate & { id: string }; Update: ProfileUpdate };
      programs: { Row: Program; Insert: ProgramCreate; Update: Partial<ProgramCreate> & { is_active?: boolean } };
      program_measures: { Row: ProgramMeasure; Insert: MeasureCreate; Update: Partial<MeasureCreate> & { is_active?: boolean } };
      measure_sessions: { Row: MeasureSession; Insert: SessionCreate; Update: Partial<SessionCreate> & { status?: SessionStatus } };
      projects: { Row: Project; Insert: ProjectCreate; Update: ProjectUpdate };
      project_phases: { Row: ProjectPhase; Insert: Omit<ProjectPhase, 'id' | 'created_at'>; Update: Partial<Pick<ProjectPhase, 'status' | 'started_at' | 'completed_at'>> };
      project_activities: { Row: ProjectActivity; Insert: Omit<ProjectActivity, 'id' | 'created_at' | 'updated_at'>; Update: ProjectActivityUpdate };
      activity_document_requirements: { Row: ActivityDocumentRequirement; Insert: ActivityDocumentRequirementCreate; Update: Partial<ActivityDocumentRequirementCreate> & { status?: DocumentRequirementStatus } };
      activity_document_files: { Row: ActivityDocumentFile; Insert: ActivityDocumentFileCreate & { uploaded_by: string }; Update: ActivityDocumentFileReview & { reviewed_by?: string; reviewed_at?: string } };
      audit_logs: { Row: AuditLog; Insert: Omit<AuditLog, 'id' | 'created_at'>; Update: never };
      notifications: { Row: Notification; Insert: NotificationCreate; Update: { is_read?: boolean } };
    };
    Views: {
      programs_overview: { Row: ProgramOverview };
      measures_overview: { Row: MeasureOverview };
      sessions_overview: { Row: SessionOverview };
      funding_hierarchy: { Row: FundingHierarchy };
      project_progress_view: { Row: ProjectProgress };
      activity_documents_status: { Row: ActivityDocumentsStatus };
      project_activities_complete: { Row: ProjectActivityComplete };
    };
    Functions: {
      advance_project_phase: { Args: { p_project_id: string; p_complete_current?: boolean }; Returns: { previous_phase: string; current_phase: string; success: boolean }[] };
      revert_project_phase: { Args: { p_project_id: string; p_target_phase_slug: string }; Returns: boolean };
      add_session: { Args: { p_measure_id: string; p_name: string; p_code?: string; p_start_date?: string; p_end_date?: string; p_budget?: number }; Returns: string };
      get_upcoming_deadlines: { Args: { p_days?: number; p_user_id?: string }; Returns: UpcomingDeadline[] };
      log_audit: { Args: { p_action_type: AuditActionType; p_entity_type: AuditEntityType; p_entity_id: string; p_entity_name?: string; p_old_values?: Record<string, unknown>; p_new_values?: Record<string, unknown>; p_description?: string }; Returns: string };
      create_notification: { Args: { p_user_id: string; p_type: NotificationType; p_title: string; p_message?: string; p_entity_type?: string; p_entity_id?: string }; Returns: string };
      is_admin: { Args: Record<string, never>; Returns: boolean };
    };
  };
}