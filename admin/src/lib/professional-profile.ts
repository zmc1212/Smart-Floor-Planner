import type {
  AdminUserRecord,
  EnterpriseRecord,
} from '@/db/repositories';

export const PROFESSIONAL_PROFILE_ROLES = ['designer', 'measurer'] as const;
export type ProfessionalProfileRole = (typeof PROFESSIONAL_PROFILE_ROLES)[number];
export type ProfessionalTitleVisibilityPolicy =
  | 'follow_staff'
  | 'force_show'
  | 'force_hide';

export type PublicProfessionalProfile = {
  titleVisible: boolean;
  title: string | null;
  experienceLabel: string;
  serviceLabel: string;
  serviceCountMode: 'enterprise_default' | 'actual';
};

export type ProfessionalProfileDetails = PublicProfessionalProfile & {
  role: ProfessionalProfileRole;
  staffTitle: string;
  careerStartYear: number | null;
  staffTitleVisible: boolean;
  adminTitleOverride: string;
  profileLocked: boolean;
  showActualServiceCount: boolean;
  actualServiceCount: number;
  canShowActualServiceCount: boolean;
  enterpriseForceProfile: boolean;
  enterpriseTitleVisibilityPolicy: ProfessionalTitleVisibilityPolicy;
  enterpriseDefaultTitle: string;
  enterpriseDefaultExperienceYears: number;
  enterpriseServiceThreshold: number;
  titleSource: 'admin_override' | 'enterprise' | 'staff';
  experienceSource: 'enterprise' | 'staff';
};

export function isProfessionalProfileRole(
  role: string
): role is ProfessionalProfileRole {
  return PROFESSIONAL_PROFILE_ROLES.includes(role as ProfessionalProfileRole);
}

export function normalizeProfessionalTitle(value: unknown, label = '专业头衔') {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'string') throw new Error(`${label}格式不正确`);
  const normalized = value.trim();
  if (normalized.length > 20) throw new Error(`${label}不能超过20个字符`);
  return normalized;
}

export function validateCareerStartYear(value: unknown) {
  if (value === null || value === undefined || value === '') return null;
  const year = Number(value);
  const currentYear = new Date().getFullYear();
  if (!Number.isInteger(year) || year < 1950 || year > currentYear) {
    throw new Error(`从业起始年份应为 1950–${currentYear}`);
  }
  return year;
}

export function validateProfessionalTitleVisibilityPolicy(
  value: unknown
): ProfessionalTitleVisibilityPolicy {
  if (
    value !== 'follow_staff' &&
    value !== 'force_show' &&
    value !== 'force_hide'
  ) {
    throw new Error('头衔显示规则无效');
  }
  return value;
}

function roleDefaultTitle(enterprise: EnterpriseRecord, role: ProfessionalProfileRole) {
  return String(
    role === 'designer'
      ? enterprise.professionalDesignerTitle
      : enterprise.professionalMeasurerTitle
  );
}

function experienceLabel(role: ProfessionalProfileRole, years: number) {
  return `${years}年${role === 'designer' ? '设计' : '量房'}经验`;
}

export function buildProfessionalProfile(input: {
  enterprise: EnterpriseRecord;
  staff: AdminUserRecord;
  actualServiceCount: number;
  displayRole?: ProfessionalProfileRole;
}): ProfessionalProfileDetails | null {
  const { enterprise, staff } = input;
  const role = input.displayRole
    || (isProfessionalProfileRole(staff.role) ? staff.role : null);
  if (!role) return null;
  const enterpriseTitle = roleDefaultTitle(enterprise, role).trim()
    || (role === 'designer' ? '金牌家装设计顾问' : '资深家装现场顾问');
  const adminTitleOverride = String(staff.professionalTitleAdminOverride || '').trim();
  const staffTitle = String(staff.professionalTitle || '').trim();
  const enterpriseForceProfile = Boolean(enterprise.professionalForceEnterpriseProfile);
  const title = adminTitleOverride
    || (enterpriseForceProfile ? enterpriseTitle : staffTitle || enterpriseTitle);
  const titleSource: ProfessionalProfileDetails['titleSource'] = adminTitleOverride
    ? 'admin_override'
    : enterpriseForceProfile || !staffTitle
      ? 'enterprise'
      : 'staff';

  const visibilityPolicy = validateProfessionalTitleVisibilityPolicy(
    enterprise.professionalTitleVisibilityPolicy
  );
  const titleVisible = visibilityPolicy === 'force_show'
    ? true
    : visibilityPolicy === 'force_hide'
      ? false
      : Boolean(staff.professionalTitleVisible);

  const currentYear = new Date().getFullYear();
  const careerStartYear = staff.professionalCareerStartYear;
  const staffExperienceYears = careerStartYear
    ? Math.max(1, currentYear - careerStartYear)
    : null;
  const useStaffExperience = !enterpriseForceProfile && staffExperienceYears !== null;
  const displayExperienceYears = useStaffExperience
    ? staffExperienceYears
    : enterprise.professionalDefaultExperienceYears;

  const actualServiceCount = Math.max(0, Math.trunc(input.actualServiceCount || 0));
  const threshold = Math.max(100, enterprise.professionalServiceThreshold);
  const canShowActualServiceCount = actualServiceCount > threshold;
  const useActualServiceCount = canShowActualServiceCount
    && Boolean(staff.professionalShowActualServiceCount);

  return {
    role,
    titleVisible,
    title: titleVisible ? title : null,
    experienceLabel: experienceLabel(role, displayExperienceYears),
    serviceLabel: useActualServiceCount
      ? `已免费服务${actualServiceCount}位客户`
      : `已免费服务客户${threshold}+`,
    serviceCountMode: useActualServiceCount ? 'actual' : 'enterprise_default',
    staffTitle,
    careerStartYear: careerStartYear ?? null,
    staffTitleVisible: Boolean(staff.professionalTitleVisible),
    adminTitleOverride,
    profileLocked: Boolean(staff.professionalProfileLocked),
    showActualServiceCount: Boolean(staff.professionalShowActualServiceCount),
    actualServiceCount,
    canShowActualServiceCount,
    enterpriseForceProfile,
    enterpriseTitleVisibilityPolicy: visibilityPolicy,
    enterpriseDefaultTitle: enterpriseTitle,
    enterpriseDefaultExperienceYears: enterprise.professionalDefaultExperienceYears,
    enterpriseServiceThreshold: threshold,
    titleSource,
    experienceSource: useStaffExperience ? 'staff' : 'enterprise',
  };
}

export function publicProfessionalProfile(
  profile: ProfessionalProfileDetails | null
): PublicProfessionalProfile | null {
  if (!profile) return null;
  return {
    titleVisible: profile.titleVisible,
    title: profile.title,
    experienceLabel: profile.experienceLabel,
    serviceLabel: profile.serviceLabel,
    serviceCountMode: profile.serviceCountMode,
  };
}
