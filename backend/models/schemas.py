from __future__ import annotations
from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
from enum import Enum


class ScoreLabel(str, Enum):
    NOT_USED      = "Not Used"
    RARELY_USED   = "Rarely Used"
    ACTIVELY_USED = "Actively Used"
    FULLY_USED    = "Fully Used"
    UNKNOWN       = "Unknown"       # no utilisation metrics — cannot assess


class TrendDirection(str, Enum):
    RISING  = "rising"
    STABLE  = "stable"
    FALLING = "falling"
    IDLE    = "idle"


class AdvisorRecommendation(BaseModel):
    category:          str
    impact:            str
    short_description: str
    score_impact:      int
    potential_savings: float = 0.0


class ResourceMetrics(BaseModel):
    resource_id:    str
    resource_name:  str
    resource_type:  str
    resource_group: str
    location:       str
    sku:            Optional[str] = None

    # Cost
    cost_current_month:      float = 0.0
    cost_previous_month:     float = 0.0
    cost_previous_month_mtd: float = 0.0   # last month spend for same elapsed days (MTD-to-MTD delta)
    cost_delta_is_mtd:       bool  = False  # True = delta is MTD-to-MTD, False = full month fallback
    cost_delta_pct:          float = 0.0

    # Utilisation
    avg_cpu_pct:               Optional[float] = None
    avg_memory_pct:            Optional[float] = None
    avg_disk_pct:              Optional[float] = None
    avg_network_pct:           Optional[float] = None
    primary_utilization_pct:   Optional[float] = None
    has_any_activity:          bool = False

    # Scoring breakdown
    base_score:              float = 0.0
    advisor_score_delta:     int   = 0
    trend_modifier:          int   = 0
    ai_score_adjustment:     int   = 0
    final_score:             float = 0.0
    score_label:             ScoreLabel     = ScoreLabel.NOT_USED
    trend:                   TrendDirection = TrendDirection.STABLE

    # Azure Advisor
    advisor_recommendations: List[AdvisorRecommendation] = Field(default_factory=list)

    # AI
    ai_confidence:  Optional[str] = None
    ai_action:      Optional[str] = None
    ai_explanation: Optional[str] = None

    # Activity log
    last_active_date:  Optional[str] = None
    days_since_active: Optional[int] = None
    activity_log_count: int = 0
    idle_confirmed:    bool = False

    # Right-sizing
    rightsize_sku:          Optional[str] = None
    rightsize_savings_pct:  float = 0.0

    # Reserved instance opportunity
    ri_1yr_monthly_savings: float = 0.0
    ri_3yr_monthly_savings: float = 0.0
    ri_eligible:            bool  = False

    # Safe decommission steps — staged action plan for this resource
    safe_action_steps: List[Dict] = Field(default_factory=list)
    steps_source: str = "rules"   # "ai" | "rules" — drives the action plan header label

    # Tag compliance
    missing_tags: List[str] = Field(default_factory=list)

    # Carbon
    carbon_kg_per_month: float = 0.0

    # Links & commands
    portal_url:      str = ""
    cli_delete_cmd:  str = ""
    cli_resize_cmd:  str = ""

    # Cost anomaly
    is_anomaly:          bool = False
    daily_costs:         List[float] = Field(default_factory=list)
    cost_7d_trend_pct:   Optional[float] = None

    # Month-over-month daily spend (for trend chart)
    # daily_costs_cm: day 1 → today of current calendar month
    # daily_costs_pm: day 1 → last day of previous calendar month (full)
    daily_costs_cm:      List[float] = Field(default_factory=list)
    daily_costs_pm:      List[float] = Field(default_factory=list)

    # Savings
    estimated_monthly_savings: float = 0.0
    recommendation:            Optional[str] = None

    # Orphan
    is_orphan:     bool          = False
    orphan_reason: Optional[str] = None

    # Subscription
    subscription_id: str = ""

    # Resource category — drives smarter scoring display
    resource_category: str  = "other"   # "infrastructure" | "compute" | "storage" | "data" | "ai" | "other"
    is_infrastructure: bool = False

    # Observability — how much monitoring data backs this score
    data_confidence:  str = "none"    # "high" | "medium" | "low" | "none"
    telemetry_source: str = "none"    # "monitor" | "activity_only" | "cost_only" | "none"

    # AI / Cognitive Services token metrics (AI1–AI7)
    prompt_tokens:     Optional[float] = None   # AI1: ProcessedPromptTokens (30-day total)
    completion_tokens: Optional[float] = None   # AI1: ProcessedCompletionTokens (30-day total)
    total_tokens:      Optional[float] = None   # AI1: prompt + completion
    total_calls:       Optional[float] = None   # AI3: TotalCalls (for cost-per-request)
    blocked_calls:     Optional[float] = None   # AI4: BlockedCalls (throttle indicator)
    billing_type:      Optional[str]   = None   # AI7: "ptu" | "consumption"

    # Storage-specific signals (storage accounts only)
    storage_last_access_tracking: bool = False   # blob last-access time tracking enabled
    storage_has_lifecycle_policy:  bool = False   # lifecycle tiering/expiry rules configured

    # Resource protection & state
    has_backup:      bool          = False   # resource is protected by an Azure Backup policy
    has_lock:        bool          = False   # resource/RG/sub has a delete or read-only lock
    power_state:     Optional[str] = None    # VMs only: running/deallocated/stopped/unknown
    auto_shutdown:         bool = False   # VM has a DevTest Labs auto-shutdown schedule
    rbac_assignment_count: int  = 0       # direct role assignments scoped to this resource
    ri_covered:            bool = False   # active reservation exists for this resource type + location
    has_private_endpoint:  bool = False   # resource is targeted by a private endpoint
    is_sql_replica:        bool = False   # SQL database is a geo/named replica of a primary
    # A1–A8: App Service detail fields (web/function/logic apps only)
    app_kind:             Optional[str] = None   # "web" | "function" | "logic"
    runtime_stack:        Optional[str] = None   # e.g. "Python 3.11", "Node 20"
    last_modified:        Optional[str] = None   # ISO datetime of last config change
    custom_domain_count:  int  = 0
    health_check_enabled: bool = False
    health_check_path:    Optional[str] = None
    ssl_expiry_date:      Optional[str] = None   # earliest SSL cert expiry (ISO)
    slot_count:           int  = 0               # deployment slots excluding production
    has_linked_storage:   bool = False

    app_state:        Optional[str] = None   # "running" | "stopped"

    # App Service grouping helpers
    instance_count:  Optional[int] = None   # VMSS/App Service Plan instance count
    server_farm_id:  Optional[str] = None   # web apps: parent App Service Plan resource ID

    # 6-month cost history (oldest → newest), populated by get_monthly_cost_history()
    monthly_cost_history: List[float] = Field(default_factory=list)

    tags: Dict[str, str] = Field(default_factory=dict)

    # S17: Intent vs Usage separation
    # Intent/protection signals (locks, RBAC, backup, RI, PE) block deletion but do NOT boost score
    is_protected:       bool      = False
    protection_reasons: List[str] = Field(default_factory=list)

    # S18: Peak and burst detection
    peak_utilization_pct: Optional[float] = None   # maximum utilization seen in 30-day window

    # D2: Waste Age — how long a resource has been idle and how much it has cost
    idle_since_date:      Optional[str]   = None   # ISO date when resource last had meaningful activity
    days_idle:            Optional[int]   = None   # days since idle_since_date
    cumulative_waste_usd: Optional[float] = None   # days_idle × daily_cost_rate

    # S19: Workload pattern classification
    workload_pattern: Optional[str] = None  # "steady_low" | "bursty" | "declining" | "inactive" | "normal"

    # S22: "Why NOT waste" explanation — highest-confidence reason the resource was kept
    protection_reason: Optional[str] = None


class OrphanResource(BaseModel):
    resource_id:    str
    resource_name:  str
    resource_type:  str
    resource_group: str
    orphan_reason:  str
    monthly_cost:   float = 0.0
    estimated_savings: float = 0.0


class SavingsRecommendation(BaseModel):
    resource_id:    str
    resource_name:  str
    resource_type:  str
    resource_group: str
    current_monthly_cost:      float
    estimated_monthly_savings: float
    savings_pct:               float
    recommendation:            str
    ai_explanation:            Optional[str] = None
    ai_action:                 Optional[str] = None
    priority:                  str
    score:                     float
    advisor_count:             int = 0


class KPIData(BaseModel):
    total_cost_current_month:  float
    total_cost_previous_month: float
    mom_cost_delta:            float
    mom_cost_delta_pct:        float
    total_resources:           int
    avg_optimization_score:    float
    total_potential_savings:   float
    orphan_count:              int
    orphan_cost:               float
    advisor_total_recs:        int = 0
    ai_reviewed_count:         int = 0
    # Actionable health metrics
    not_used_count:            int   = 0   # resources scoring <= 25 (excluding infrastructure)
    not_used_cost:             float = 0.0 # monthly cost of "Not Used" resources
    infrastructure_count:      int   = 0   # infrastructure resources (no util metrics by design)
    health_score_pct:          float = 0.0 # % of scorable resources that are Actively/Fully Used
    subscription_count:        int   = 1   # number of subscriptions scanned
    # Billing context — set when the current month has fewer than 7 days of data
    billing_basis:             str   = "current_month"  # "current_month" | "previous_month"
    billing_days_current:      int   = 0   # how many days of the current month have billing data
    # Composite Cost Score — 0–100 across 5 weighted dimensions
    cost_score:            float           = 0.0
    cost_grade:            str             = "—"
    cost_score_label:      str             = ""
    cost_score_components: Dict[str,float] = Field(default_factory=dict)


class ScoreDistribution(BaseModel):
    label:      str
    count:      int
    total_cost: float
    color:      str


class ResourceTypeSummary(BaseModel):
    resource_type:        str
    display_name:         str
    count:                int
    cost_current_month:   float
    cost_previous_month:  float
    avg_score:            float
    advisor_rec_count:    int = 0


class CostAnomaly(BaseModel):
    resource_id:          str
    resource_name:        str
    resource_type:        str
    resource_group:       str
    avg_daily_cost_30d:   float
    latest_daily_cost:    float
    anomaly_factor:       float


class RightSizeOpportunity(BaseModel):
    resource_id:       str
    resource_name:     str
    resource_type:     str
    resource_group:    str
    current_sku:       str
    suggested_sku:     str
    current_cost:      float
    estimated_savings: float
    savings_pct:       float
    reason:            str
    cpu_pct:           Optional[float] = None


class AppSettings(BaseModel):
    azure_client_id:        str = ""
    azure_client_secret:    str = ""   # masked
    azure_tenant_id:        str = ""
    azure_subscription_id:  str = ""
    azure_subscription_ids: str = ""   # comma-separated list of additional subscription IDs
    has_azure_secret:       bool = False
    auth_ready:             bool = False   # True when the app can reach Azure (SP creds OR managed identity)
    # AI provider
    ai_provider:           str = "claude"   # "claude" | "azure_openai" | "none"
    # Claude
    has_anthropic_key:     bool = False
    anthropic_api_key:     str = ""   # masked
    # Azure OpenAI
    azure_openai_endpoint:   str = ""
    azure_openai_key:        str = ""  # masked
    azure_openai_deployment: str = "gpt-4o-mini"
    has_azure_openai_key:    bool = False
    # Scoring
    idle_threshold_pct:    float = 3.0
    no_metrics_age_days:   int   = 7
    cost_floor_usd:        float = 1.0
    ai_cost_threshold_usd: float = 20.0
    cache_ttl_seconds:     int   = 1800
    demo_mode:             bool  = False
    auto_refresh_interval_hours: int = 6
    # Scan scope — limits what gets scanned (for testing/validation)
    scan_scope_subscription_id: str = ""
    scan_scope_resource_group:  str = ""


class CacheStatus(BaseModel):
    data_available:    bool = False
    last_refreshed:    Optional[str] = None   # ISO timestamp of last successful scan
    is_refreshing:     bool = False
    next_refresh:      Optional[str] = None   # ISO timestamp of next scheduled scan
    auto_refresh_interval_hours: int = 0


class SubscriptionSummary(BaseModel):
    subscription_id:   str
    subscription_name: str   = ""
    resource_count:    int   = 0
    cost_current:      float = 0.0
    cost_previous:     float = 0.0
    orphan_count:      int   = 0
    advisor_rec_count: int   = 0


class DashboardData(BaseModel):
    kpi:                    KPIData
    score_distribution:     List[ScoreDistribution]
    resource_type_summary:  List[ResourceTypeSummary]
    resources:              List[ResourceMetrics]
    orphans:                List[OrphanResource]
    savings_recommendations: List[SavingsRecommendation]
    last_refreshed:         str
    ai_enabled:             bool = False
    ai_provider:            str  = "none"
    ai_narrative:           Optional[str] = None   # AI-generated plain-English summary
    demo_mode:              bool = False
    total_carbon_kg:        float = 0.0
    tag_compliance_pct:     float = 100.0
    total_untagged:         int   = 0
    cost_anomalies:         List[CostAnomaly] = Field(default_factory=list)
    rightsize_opportunities: List[RightSizeOpportunity] = Field(default_factory=list)
    subscriptions:          List[SubscriptionSummary] = Field(default_factory=list)
    resource_groups:        List[str] = Field(default_factory=list)  # distinct RG names for filter
    # Active scan scope (echoes back what was actually applied)
    active_resource_group:    str = ""
    active_subscription_id:   str = ""
    scan_scope_active:        bool = False  # true when a default scope is limiting the scan
    active_reservations:            List[Dict[str, Any]] = Field(default_factory=list)
    reservation_over_commitment_usd: float             = 0.0   # estimated monthly waste from underutilized RIs
    reservation_recommendations:    List[Dict[str, Any]] = Field(default_factory=list)
    cost_data_warning:              Optional[str]      = None   # set when Cost Management API returns no data
    # Aggregated daily totals for the spend-trend chart (not per-resource, no pagination risk)
    total_daily_cm:           List[float] = Field(default_factory=list)  # current month day 1→today
    total_daily_pm:           List[float] = Field(default_factory=list)  # full previous month
    # ── New strategic features ─────────────────────────────────────────────
    waf_scorecard:            Optional["WAFScorecard"]          = None
    security_gaps:            List["SecurityGap"]               = Field(default_factory=list)
    modernization_opportunities: List["ModernizationOpportunity"] = Field(default_factory=list)
    # ── Innovation & maturity features ─────────────────────────────────────
    innovation_gaps:          List["InnovationGap"]             = Field(default_factory=list)
    service_adoption_scores:  List["ServiceAdoptionScore"]      = Field(default_factory=list)
    cloud_maturity:           Optional["CloudMaturityScore"]    = None
    licensing_opportunities:  List["LicensingOpportunity"]      = Field(default_factory=list)
    # ── Backup coverage ────────────────────────────────────────────────────
    backup_coverage:          Optional["BackupCoverage"]        = None    # ── ACR Growth Opportunities ───────────────────────────────────────────────
    acr_opportunities:        Optional["ACROpportunities"]      = None

# ── WAF Scorecard ──────────────────────────────────────────────────────────────

class WAFPillar(BaseModel):
    pillar:             str            # "Cost Optimization" | "Reliability" | "Security" | "Operational Excellence" | "Performance Efficiency"
    score:              float          # 0-100
    grade:              str            # "A" | "B" | "C" | "D" | "F"
    color:              str            # hex
    gaps:               List[str]      = Field(default_factory=list)   # top gaps
    recommendations:    List[str]      = Field(default_factory=list)   # Azure services to fix gaps
    resource_gap_count: int            = 0


class WAFScorecard(BaseModel):
    overall_score:  float
    overall_grade:  str
    pillars:        List[WAFPillar]
    generated_at:   str


# ── Security Gaps ──────────────────────────────────────────────────────────────

class SecurityGap(BaseModel):
    resource_id:      str
    resource_name:    str
    resource_type:    str
    resource_group:   str
    subscription_id:  str   = ""
    gap_type:         str   # "no_backup" | "public_exposure" | "no_private_endpoint" | "no_lock" | "missing_tags" | "unmonitored"
    severity:         str   # "critical" | "high" | "medium" | "low"
    title:            str
    description:      str
    azure_service:    str   # recommended Azure service
    monthly_risk_usd: float = 0.0


# ── Modernization Opportunities ────────────────────────────────────────────────

class MigrationStep(BaseModel):
    phase:       str   # "assess" | "prepare" | "migrate" | "validate" | "optimize"
    title:       str
    detail:      str   = ""
    az_cli:      str   = ""   # optional CLI snippet
    effort_days: int   = 1


class ModernizationOpportunity(BaseModel):
    resource_id:            str
    resource_name:          str
    resource_type:          str
    resource_group:         str
    subscription_id:        str   = ""
    current_config:         str
    target_service:         str
    target_service_type:    str   # Azure resource type slug
    complexity:             str   # "Low" | "Medium" | "High"
    estimated_savings_pct:  float = 0.0
    monthly_cost:           float = 0.0
    reason:                 str
    benefits:               List[str] = Field(default_factory=list)
    migration_steps:        List[MigrationStep] = Field(default_factory=list)
    migration_wave:         int   = 1   # 1=quick-win 2=standard 3=complex
    estimated_effort_days:  int   = 0   # total calendar days for migration
    five_r:                 str   = ""   # "Rehost" | "Refactor" | "Rearchitect" | "Rebuild" | "Retire"
    migration_category:     str   = ""   # "compute" | "database" | "storage" | "app_platform" | "container" | "network" | "messaging"
    risk_score:             int   = 0    # 0-100 migration risk
    dependency_count:       int   = 0    # number of hard dependencies


# ── Migration Assessment (comprehensive migration state) ───────────────────────

class MigrationWaveGroup(BaseModel):
    wave:              int               # 0=immediate, 1=quick-win, 2=standard, 3=complex
    label:             str
    description:       str
    total_resources:   int   = 0
    total_savings:     float = 0.0
    total_effort_days: int   = 0
    items:             List[ModernizationOpportunity] = Field(default_factory=list)


class FiveRSummary(BaseModel):
    category:       str               # "Rehost" | "Refactor" | "Rearchitect" | "Rebuild" | "Retire" | "Retain"
    count:          int   = 0
    total_cost:     float = 0.0
    potential_savings: float = 0.0
    description:    str   = ""


class MigrationCategorySummary(BaseModel):
    category:       str               # "compute" | "database" | "storage" | "app_platform" | "container" | "messaging"
    icon:           str   = ""
    count:          int   = 0
    total_cost:     float = 0.0
    potential_savings: float = 0.0


class MigrationAssessment(BaseModel):
    total_resources_assessed: int   = 0
    total_opportunities:      int   = 0
    total_monthly_savings:    float = 0.0
    total_annual_savings:     float = 0.0
    total_effort_days:        int   = 0
    migration_readiness_pct:  float = 0.0       # % of estate that has a clear migration path
    iaas_pct:                 float = 0.0       # % IaaS vs PaaS
    paas_pct:                 float = 0.0
    five_r_summary:           List[FiveRSummary]           = Field(default_factory=list)
    category_summary:         List[MigrationCategorySummary] = Field(default_factory=list)
    wave_groups:              List[MigrationWaveGroup]      = Field(default_factory=list)
    opportunities:            List[ModernizationOpportunity] = Field(default_factory=list)
    generated_at:             str   = ""


# ── Innovation Gap Analysis ────────────────────────────────────────────────────

class InnovationGap(BaseModel):
    category:          str          # "AI & Machine Learning", "Containers", etc.
    category_key:      str          # snake_case key
    icon:              str          # emoji
    status:            str          # "not_adopted" | "partially_adopted"
    description:       str          # what this category delivers
    opportunity:       str          # what the customer is missing out on
    azure_services:    List[str]    # specific Azure services to recommend
    business_impact:   str          # "High" | "Medium" | "Low"
    estimated_effort:  str          # "Low" | "Medium" | "High"
    current_resource_count: int = 0
    recommendation_detail: str = ""


class ServiceAdoptionScore(BaseModel):
    category:       str
    category_key:   str
    icon:           str
    adopted:        bool
    partial:        bool
    resource_count: int
    resource_types_present: List[str] = Field(default_factory=list)


# ── Cloud Maturity Index ───────────────────────────────────────────────────────

class MaturityDimension(BaseModel):
    key:             str
    name:            str
    score:           float   # 0–100
    grade:           str     # A–F
    color:           str
    description:     str
    gaps:            List[str] = Field(default_factory=list)
    recommendations: List[str] = Field(default_factory=list)


class CloudMaturityScore(BaseModel):
    overall_score:  float
    overall_grade:  str
    overall_label:  str     # "Cloud Native" | "Cloud Smart" | "Cloud Ready" | "Cloud Aware" | "Traditional IT"
    dimensions:     List[MaturityDimension]
    generated_at:   str


# ── Licensing & Hybrid Benefit Opportunities ──────────────────────────────────

class LicensingOpportunity(BaseModel):
    opportunity_type: str          # "ahub_windows" | "ahub_sql" | "reserved_instance" | "spot_eligible" | "burstable_eligible"
    resource_id:      str
    resource_name:    str
    resource_type:    str
    resource_group:   str
    subscription_id:  str   = ""
    current_sku:      str   = ""
    description:      str
    estimated_monthly_saving: float = 0.0
    confidence:       str   = "medium"  # "high" | "medium" | "low"
    implementation:   str   = ""
    az_cli:           str   = ""


# ── Backup Coverage ────────────────────────────────────────────────────────────

class BackupGap(BaseModel):
    resource_id:          str
    resource_name:        str
    resource_type:        str
    resource_group:       str
    subscription_id:      str   = ""
    backup_category:      str
    backup_category_key:  str
    icon:                 str   = "📦"
    severity:             str
    gap_type:             str
    backup_solution:      str
    description:          str
    recommendation:       str
    az_link:              str   = ""
    estimated_monthly_cost: float = 0.0


class BackupCategoryStats(BaseModel):
    category:         str
    category_key:     str
    icon:             str   = "📦"
    eligible:         int
    protected:        int
    gaps:             int
    coverage_pct:     float
    gap_type:         str   = "no_backup"
    protection_type:  str   = "vault"


class BackupCoverage(BaseModel):
    total_eligible:   int
    total_protected:  int
    total_gaps:       int
    coverage_pct:     float
    categories:       List["BackupCategoryStats"] = Field(default_factory=list)
    critical_gaps:    int   = 0
    high_gaps:        int   = 0
    medium_gaps:      int   = 0
    low_gaps:         int   = 0
    gaps:             List["BackupGap"] = Field(default_factory=list)
    generated_at:     str   = ""


# ── ACR Growth Opportunities ──────────────────────────────────────────────────

class ACRGap(BaseModel):
    resource_id:              str
    resource_name:            str
    resource_type:            str
    resource_group:           str
    subscription_id:          str   = ""
    category:                 str
    category_key:             str
    icon:                     str   = "🔧"
    title:                    str
    description:              str
    severity:                 str   # "critical" | "high" | "medium" | "low"
    acr_impact:               str   # "high" | "medium" | "low"
    azure_service:            str
    estimated_monthly_acr:    float = 0.0
    resource_monthly_cost:    float = 0.0
    implementation_steps:     List[str] = Field(default_factory=list)
    az_cli_snippet:           str   = ""
    documentation_url:        str   = ""


class ACRCategoryStats(BaseModel):
    category:            str
    category_key:        str
    icon:                str   = "🔧"
    total_eligible:      int
    covered:             int
    gaps:                int
    coverage_pct:        float
    estimated_total_acr: float = 0.0
    acr_impact:          str   = "medium"


class ACROpportunities(BaseModel):
    categories:                   List["ACRCategoryStats"] = Field(default_factory=list)
    gaps:                         List["ACRGap"]           = Field(default_factory=list)
    total_eligible:               int   = 0
    total_covered:                int   = 0
    total_gaps:                   int   = 0
    coverage_pct:                 float = 0.0
    estimated_total_monthly_acr:  float = 0.0
    critical_count:               int   = 0
    high_count:                   int   = 0
    medium_count:                 int   = 0
    low_count:                    int   = 0
    generated_at:                 str   = ""


# ═══════════════════════════════════════════════════════════════════════════════
# ON-PREMISES DATA COLLECTION MODULE
# ═══════════════════════════════════════════════════════════════════════════════

class OnPremDisk(BaseModel):
    drive_letter:   str   = ""
    label:          str   = ""
    size_gb:        float = 0.0
    free_gb:        float = 0.0
    used_pct:       float = 0.0
    disk_type:      str   = ""      # SSD | HDD | Unknown
    filesystem:     str   = ""      # NTFS | ReFS | ext4

class OnPremNetAdapter(BaseModel):
    name:           str   = ""
    ip_address:     str   = ""
    subnet_mask:    str   = ""
    default_gateway: str  = ""
    dns_servers:    List[str] = Field(default_factory=list)
    speed_mbps:     int   = 0
    mac_address:    str   = ""
    status:         str   = ""      # Up | Down

class OnPremApplication(BaseModel):
    name:           str   = ""
    version:        str   = ""
    publisher:      str   = ""
    install_date:   str   = ""

class OnPremService(BaseModel):
    name:           str   = ""
    display_name:   str   = ""
    status:         str   = ""      # Running | Stopped
    start_type:     str   = ""      # Automatic | Manual | Disabled
    account:        str   = ""      # LocalSystem | NetworkService | custom

class OnPremSqlDatabase(BaseModel):
    name:           str   = ""
    size_mb:        float = 0.0
    recovery_model: str   = ""      # Full | Simple | Bulk-Logged
    compat_level:   int   = 0
    state:          str   = ""      # ONLINE | OFFLINE
    last_backup:    str   = ""

class OnPremSqlInstance(BaseModel):
    instance_name:  str   = ""
    version:        str   = ""
    edition:        str   = ""      # Standard | Enterprise | Express
    service_pack:   str   = ""
    collation:      str   = ""
    tcp_port:       int   = 1433
    max_memory_mb:  int   = 0
    max_dop:        int   = 0
    databases:      List[OnPremSqlDatabase] = Field(default_factory=list)

class OnPremIISSite(BaseModel):
    name:           str   = ""
    bindings:       str   = ""
    physical_path:  str   = ""
    state:          str   = ""
    app_pool:       str   = ""

class OnPremCertificate(BaseModel):
    subject:        str   = ""
    issuer:         str   = ""
    thumbprint:     str   = ""
    expiry_date:    str   = ""
    store:          str   = ""      # LocalMachine\My | LocalMachine\Root
    not_before:     str   = ""
    has_private_key: bool = False
    key_usage:      str   = ""
    days_until_expiry: int = 0

class OnPremProcess(BaseModel):
    name:           str   = ""
    pid:            int   = 0
    command_line:   str   = ""
    memory_mb:      float = 0.0
    cpu_time_sec:   float = 0.0
    owner:          str   = ""
    parent_pid:     int   = 0

class OnPremScheduledTask(BaseModel):
    name:           str   = ""
    path:           str   = ""
    state:          str   = ""
    author:         str   = ""
    last_run:       str   = ""
    last_result:    int   = -1
    next_run:       str   = ""
    action:         str   = ""
    run_as:         str   = ""

class OnPremEventSummary(BaseModel):
    log:            str   = ""
    source:         str   = ""
    count:          int   = 0
    level:          str   = ""
    latest_message: str   = ""
    latest_time:    str   = ""

class OnPremFileShare(BaseModel):
    name:           str   = ""
    path:           str   = ""
    description:    str   = ""
    share_type:     str   = ""
    size_gb:        float = 0.0
    current_users:  int   = 0

class OnPremHotfix(BaseModel):
    hotfix_id:      str   = ""
    description:    str   = ""
    installed_on:   str   = ""
    installed_by:   str   = ""

class OnPremPhysicalDisk(BaseModel):
    model:          str   = ""
    size_gb:        float = 0.0
    interface_type: str   = ""
    media_type:     str   = ""
    partitions:     int   = 0
    serial:         str   = ""
    firmware:       str   = ""
    status:         str   = ""

class OnPremRAMDimm(BaseModel):
    capacity_gb:    float = 0.0
    speed_mhz:      int   = 0
    type:           int   = 0

class OnPremHyperVVM(BaseModel):
    name:           str   = ""
    state:          str   = ""
    cpu:            int   = 0
    memory_mb:      int   = 0
    generation:     int   = 0

class OnPremClusterResource(BaseModel):
    name:           str   = ""
    type:           str   = ""
    state:          str   = ""
    owner:          str   = ""

class OnPremBackupAgent(BaseModel):
    name:           str   = ""
    service_status: str   = ""
    installed:      bool  = False

class OnPremLocalUser(BaseModel):
    name:           str   = ""
    enabled:        bool  = True
    last_logon:     str   = ""
    password_expires: str = ""
    password_last_set: str = ""
    description:    str   = ""

class OnPremLocalGroup(BaseModel):
    name:           str   = ""
    description:    str   = ""
    members:        List[str] = Field(default_factory=list)


class OnPremServer(BaseModel):
    """Comprehensive on-premises server record collected via PowerShell."""
    # Identity
    server_id:              str   = ""
    hostname:               str   = ""
    fqdn:                   str   = ""
    domain:                 str   = ""
    ip_addresses:           List[str] = Field(default_factory=list)
    mac_addresses:          List[str] = Field(default_factory=list)

    # Hardware
    manufacturer:           str   = ""
    model:                  str   = ""
    serial_number:          str   = ""
    bios_version:           str   = ""
    total_cores:            int   = 0
    total_logical_processors: int = 0
    total_memory_gb:        float = 0.0
    cpu_model:              str   = ""
    cpu_speed_ghz:          float = 0.0
    motherboard:            str   = ""
    ram_dimms:              List[OnPremRAMDimm] = Field(default_factory=list)
    physical_disks:         List[OnPremPhysicalDisk] = Field(default_factory=list)

    # OS
    os_name:                str   = ""
    os_version:             str   = ""
    os_build:               str   = ""
    os_architecture:        str   = ""      # 64-bit | 32-bit
    install_date:           str   = ""
    last_boot_time:         str   = ""
    uptime_days:            int   = 0

    # Storage
    disks:                  List[OnPremDisk] = Field(default_factory=list)
    total_storage_gb:       float = 0.0
    total_free_gb:          float = 0.0

    # Network
    network_adapters:       List[OnPremNetAdapter] = Field(default_factory=list)

    # Applications & Services
    installed_applications: List[OnPremApplication] = Field(default_factory=list)
    running_services:       List[OnPremService] = Field(default_factory=list)
    stopped_services:       List[OnPremService] = Field(default_factory=list)

    # Roles & Features
    server_roles:           List[str] = Field(default_factory=list)
    windows_features:       List[str] = Field(default_factory=list)

    # SQL Server
    sql_instances:          List[OnPremSqlInstance] = Field(default_factory=list)

    # IIS / Web
    iis_sites:              List[OnPremIISSite] = Field(default_factory=list)

    # Security
    firewall_enabled:       bool  = False
    firewall_profiles:      Dict[str, bool] = Field(default_factory=dict)  # Domain/Private/Public
    antivirus_product:      str   = ""
    antivirus_status:       str   = ""
    pending_updates_count:  int   = 0
    last_update_date:       str   = ""
    local_admins:           List[str] = Field(default_factory=list)
    open_ports:             List[int] = Field(default_factory=list)

    # Certificates
    certificates:           List[OnPremCertificate] = Field(default_factory=list)

    # Processes (top 200 by memory)
    processes:              List[OnPremProcess] = Field(default_factory=list)

    # Scheduled Tasks (non-Microsoft)
    scheduled_tasks:        List[OnPremScheduledTask] = Field(default_factory=list)

    # Event Log Summary (critical/error last 7 days)
    event_log_summary:      List[OnPremEventSummary] = Field(default_factory=list)

    # File Shares
    file_shares:            List[OnPremFileShare] = Field(default_factory=list)
    dfs_namespaces:         List[str] = Field(default_factory=list)

    # Hotfixes / Installed KBs
    hotfixes:               List[OnPremHotfix] = Field(default_factory=list)

    # Performance Baseline
    avg_cpu_pct:            Optional[float] = None
    avg_memory_pct:         Optional[float] = None
    avg_disk_queue:         Optional[float] = None
    peak_cpu_pct:           Optional[float] = None
    peak_memory_pct:        Optional[float] = None

    # Virtualization
    is_virtual:             bool  = False
    hypervisor_type:        str   = ""      # Hyper-V | VMware | KVM | None
    vm_host:                str   = ""
    vm_generation:          str   = ""
    hyperv_vms:             List[OnPremHyperVVM] = Field(default_factory=list)

    # Clustering
    is_clustered:           bool  = False
    cluster_name:           str   = ""
    cluster_nodes:          List[str] = Field(default_factory=list)
    cluster_resources:      List[OnPremClusterResource] = Field(default_factory=list)
    quorum_type:            str   = ""

    # Backup
    backup_solution:        str   = ""
    last_backup_date:       str   = ""
    backup_target:          str   = ""
    backup_agents:          List[OnPremBackupAgent] = Field(default_factory=list)
    vss_writers:            List[str] = Field(default_factory=list)

    # Monitoring
    monitoring_agent:       str   = ""
    monitoring_agent_version: str = ""

    # Local Users & Groups
    local_users:            List[OnPremLocalUser] = Field(default_factory=list)
    local_groups:           List[OnPremLocalGroup] = Field(default_factory=list)

    # AD Roles (if domain controller)
    ad_roles:               Dict[str, Any] = Field(default_factory=dict)

    # Classification (computed during ingestion)
    workload_type:          str   = ""      # Web Server | Database Server | File Server | App Server | Domain Controller | General
    migration_candidate:    bool  = False
    migration_target:       str   = ""      # Azure VM | Azure SQL MI | App Service | Azure Files
    complexity:             str   = ""      # Low | Medium | High

    # Meta
    collected_at:           str   = ""
    collection_script_version: str = ""
    collection_duration_sec: float = 0.0
    upload_batch_id:        str   = ""
    customer_notes:         str   = ""
    scan_modules:           List[str] = Field(default_factory=list)
    transport:              str   = ""      # winrm | ps_subprocess
    timezone:               str   = ""
    page_file_gb:           float = 0.0


class OnPremUploadBatch(BaseModel):
    batch_id:       str
    uploaded_at:    str
    server_count:   int   = 0
    filename:       str   = ""
    status:         str   = "completed"     # completed | partial | failed
    warnings:       List[str] = Field(default_factory=list)
    errors:         List[str] = Field(default_factory=list)


class OnPremInventorySummary(BaseModel):
    total_servers:          int   = 0
    total_cores:            int   = 0
    total_memory_gb:        float = 0.0
    total_storage_gb:       float = 0.0
    os_breakdown:           Dict[str, int] = Field(default_factory=dict)
    workload_breakdown:     Dict[str, int] = Field(default_factory=dict)
    migration_candidates:   int   = 0
    physical_servers:       int   = 0
    virtual_servers:        int   = 0
    sql_instances_count:    int   = 0
    iis_sites_count:        int   = 0
    total_applications:     int   = 0
    security_issues:        int   = 0       # servers with missing AV, updates, etc.
    upload_batches:         List[OnPremUploadBatch] = Field(default_factory=list)
    last_upload:            str   = ""


class ScriptOptions(BaseModel):
    """Options for generating the PowerShell collection script."""
    collect_hardware:       bool  = True
    collect_os:             bool  = True
    collect_applications:   bool  = True
    collect_services:       bool  = True
    collect_sql:            bool  = True
    collect_iis:            bool  = True
    collect_security:       bool  = True
    collect_certificates:   bool  = True
    collect_performance:    bool  = True
    collect_clustering:     bool  = False
    collect_hyperv:         bool  = False
    target_scope:           str   = "localhost"  # localhost | domain | custom_list
    custom_server_list:     List[str] = Field(default_factory=list)
    domain_ou_filter:       str   = ""
    credential_method:      str   = "current"    # current | prompt
    output_format:          str   = "csv"        # csv | json
    compress_output:        bool  = True
    max_concurrent:         int   = 5
    timeout_per_server:     int   = 300


# ═══════════════════════════════════════════════════════════════════════════════
# ENTERPRISE FINOPS MODULE — MODELS
# All data sourced live from Azure Cost Management APIs (identical to Azure Portal)
# ═══════════════════════════════════════════════════════════════════════════════

# ── FinOps Cost Explorer ───────────────────────────────────────────────────────

class FinOpsCostFilters(BaseModel):
    """15-dimension filter set for cost queries — maps directly to Azure Cost Management QueryFilter."""
    subscriptions:      List[str]            = Field(default_factory=list)   # subscription IDs
    resource_groups:    List[str]            = Field(default_factory=list)
    resource_types:     List[str]            = Field(default_factory=list)   # e.g. "microsoft.compute/virtualmachines"
    regions:            List[str]            = Field(default_factory=list)   # e.g. "eastus"
    service_families:   List[str]            = Field(default_factory=list)   # e.g. "Compute"
    meter_categories:   List[str]            = Field(default_factory=list)
    tags:               Dict[str, List[str]] = Field(default_factory=dict)   # key → list of values
    tag_operator:       str                  = "AND"                          # "AND" | "OR"
    environments:       List[str]            = Field(default_factory=list)   # from Environment tag
    cost_centers:       List[str]            = Field(default_factory=list)   # from CostCenter tag
    departments:        List[str]            = Field(default_factory=list)   # from Department tag
    min_cost:           Optional[float]      = None
    max_cost:           Optional[float]      = None
    include_untagged:   bool                 = True


class FinOpsCostExplorerQuery(BaseModel):
    """Mirrors Azure Cost Management QueryDefinition — what the frontend sends to /api/finops/cost-explorer."""
    time_range:   str                    = "last_30d"   # "last_7d" | "last_14d" | "last_30d" | "last_60d" | "last_90d" | "mtd" | "last_month" | "last_3mo" | "last_6mo" | "last_12mo" | "ytd" | "custom"
    date_from:    Optional[str]          = None          # ISO date, used when time_range="custom"
    date_to:      Optional[str]          = None
    granularity:  str                    = "Daily"       # "Daily" | "Monthly"
    group_by:     List[str]              = Field(default_factory=list)  # up to 3 Azure dimension names
    filters:      FinOpsCostFilters      = Field(default_factory=FinOpsCostFilters)
    cost_type:    str                    = "ActualCost"  # "ActualCost" | "AmortizedCost"
    chart_type:   str                    = "stacked_bar" # hint for frontend rendering


class FinOpsCostDataPoint(BaseModel):
    """One data row from Azure Cost Management query response."""
    date:      Optional[str]        = None         # ISO date (for daily/monthly granularity)
    label:     str                  = ""           # display label (e.g. subscription name or tag value)
    cost_usd:  float                = 0.0
    breakdown: Dict[str, float]     = Field(default_factory=dict)  # dimension_value → cost


class FinOpsCostExplorerResult(BaseModel):
    data_points:      List[FinOpsCostDataPoint] = Field(default_factory=list)
    total_usd:        float                     = 0.0
    top_contributors: List[Dict[str, Any]]      = Field(default_factory=list)  # [{label, cost, pct}]
    dimensions_used:  List[str]                 = Field(default_factory=list)
    cost_type:        str                       = "ActualCost"
    date_from:        str                       = ""
    date_to:          str                       = ""
    granularity:      str                       = "Daily"
    currency:         str                       = "USD"
    data_source:      str                       = "azure_cost_management"  # always live Azure data


# ── Budgets ────────────────────────────────────────────────────────────────────

class FinOpsBudgetDefinition(BaseModel):
    id:                str
    name:              str
    source:            str              = "custom"     # "azure_native" | "custom"
    scope_type:        str              = "subscription"  # "subscription" | "resource_group" | "all"
    scope_id:          str              = ""           # subscription ID or RG name
    amount_usd:        float            = 0.0
    period:            str              = "Monthly"    # "Monthly" | "Quarterly" | "Annual"
    start_date:        str              = ""           # ISO date
    alert_thresholds:  List[float]      = Field(default_factory=lambda: [50.0, 75.0, 90.0, 100.0])
    owner_email:       str              = ""
    cost_center:       str              = ""
    tag_filters:       Dict[str, str]   = Field(default_factory=dict)  # optional: only count tagged costs
    created_at:        str              = ""
    updated_at:        str              = ""


class FinOpsBudgetVariance(BaseModel):
    budget_id:            str
    budget_name:          str
    period_label:         str            = ""   # e.g. "April 2026"
    budgeted_usd:         float          = 0.0
    actual_usd:           float          = 0.0  # live from Azure Cost Management
    forecasted_usd:       float          = 0.0  # EOM projection
    variance_usd:         float          = 0.0  # actual - budgeted
    variance_pct:         float          = 0.0
    utilization_pct:      float          = 0.0  # actual / budgeted * 100
    status:               str            = "on_track"  # "on_track" | "at_risk" | "exceeded"
    daily_burn_rate:      float          = 0.0  # actual / elapsed days
    days_remaining:       int            = 0
    projected_overrun_usd: float         = 0.0  # max(0, forecasted - budgeted)
    daily_breakdown:      List[Dict]     = Field(default_factory=list)  # [{date, actual, budget_line}]
    data_source:          str            = "azure_cost_management"


class FinOpsBudgetAlert(BaseModel):
    budget_id:      str
    budget_name:    str             = ""
    threshold_pct:  float
    triggered_at:   str             = ""
    actual_usd:     float           = 0.0
    budgeted_usd:   float           = 0.0
    severity:       str             = "warning"    # "info" | "warning" | "critical"


# ── Forecasting ───────────────────────────────────────────────────────────────

class FinOpsForecastPoint(BaseModel):
    date:                str
    cost_usd:            float
    confidence_lower:    Optional[float]  = None   # Azure provides confidence bands
    confidence_upper:    Optional[float]  = None
    is_forecast:         bool             = False   # False = historical actual
    source:              str              = "azure_cost_management"  # "azure_cost_management" | "linear_regression_fallback"


class FinOpsForecastResult(BaseModel):
    scope_label:          str                         = "All Subscriptions"
    history:              List[FinOpsForecastPoint]   = Field(default_factory=list)  # actuals
    forecast:             List[FinOpsForecastPoint]   = Field(default_factory=list)  # future
    horizon_days:         int                         = 90
    forecast_method:      str                         = "azure_cost_management"      # or "linear_regression_fallback"
    total_forecast_usd:   float                       = 0.0   # sum of forecast period
    eom_forecast_usd:     float                       = 0.0   # end-of-current-month projection
    eoq_forecast_usd:     float                       = 0.0   # end-of-quarter projection
    trend_direction:      str                         = "stable"  # "rising" | "stable" | "falling"
    mom_trend_pct:        float                       = 0.0
    confidence_level:     str                         = "medium"  # "high" | "medium" | "low"
    generated_at:         str                         = ""


# ── Cost Allocation & Chargeback ─────────────────────────────────────────────

class FinOpsAllocationItem(BaseModel):
    dimension_value:  str             = ""
    cost_usd:         float           = 0.0
    cost_pct:         float           = 0.0


# ── Update Management ─────────────────────────────────────────────────────────

class MachineUpdateStatus(BaseModel):
    vm_id:             str   = ""
    vm_name:           str   = ""
    resource_group:    str   = ""
    subscription_id:   str   = ""
    subscription_name: str   = ""
    os_type:           str   = ""       # Windows | Linux
    machine_type:      str   = ""       # AzureVM | Arc
    last_assessment_time: str = ""
    last_patch_time:   str   = ""
    patch_status:      str   = ""       # Succeeded | Failed | InProgress | Unknown | assessment_pending
    critical_pending:  int   = 0
    security_pending:  int   = 0
    other_pending:     int   = 0
    total_pending:     int   = 0
    installed_count:   int   = 0
    failed_count:      int   = 0
    reboot_status:     str   = ""       # Required | NotRequired | Started | Completed
    days_since_patch:  int   = 0
    location:          str   = ""
    assessment_available: bool = True    # False when VM exists but has no assessment data
    tags:              Dict[str, Any] = Field(default_factory=dict)
    sku:               str   = ""       # VM size e.g. Standard_D4s_v3
    zones:             List[str] = Field(default_factory=list)


class UpdateManagementSummary(BaseModel):
    total_machines:          int   = 0
    azure_vms:               int   = 0
    arc_machines:            int   = 0
    patched_last_30d:        int   = 0
    not_patched_30d:         int   = 0
    pending_reboot:          int   = 0
    rebooted_last_30d:       int   = 0
    compliance_pct:          float = 0.0
    critical_pending:        int   = 0
    security_pending:        int   = 0
    other_pending:           int   = 0
    total_pending_patches:   int   = 0
    avg_days_since_patch:    float = 0.0
    windows_machines:        int   = 0
    linux_machines:          int   = 0
    machines_without_assessment: int = 0  # VMs visible but not yet assessed by Update Manager
    assessment_time:         str   = ""


class UpdatesByCategory(BaseModel):
    category:   str = ""      # OS type, subscription, classification
    total:      int = 0
    patched:    int = 0
    unpatched:  int = 0
    pending_reboot: int = 0
    compliance_pct: float = 0.0


class ComplianceDataPoint(BaseModel):
    date:           str   = ""
    compliance_pct: float = 0.0
    patched_count:  int   = 0
    total_count:    int   = 0


class PendingPatchDetail(BaseModel):
    patch_name:       str = ""
    classification:   str = ""    # Critical | Security | UpdateRollup | Other
    kb_id:            str = ""
    severity:         str = ""
    published_date:   str = ""
    reboot_required:  bool = False


class DetailedMachineUpdate(BaseModel):
    machine:         MachineUpdateStatus = Field(default_factory=MachineUpdateStatus)
    pending_patches: List[PendingPatchDetail] = Field(default_factory=list)
    recent_installations: List[Dict[str, Any]] = Field(default_factory=list)


class UpdateFilterOptions(BaseModel):
    subscriptions:    List[Dict[str, str]] = Field(default_factory=list)
    resource_groups:  List[str] = Field(default_factory=list)
    os_types:         List[str] = Field(default_factory=list)
    machine_types:    List[str] = Field(default_factory=list)
    locations:        List[str] = Field(default_factory=list)
    resource_count:   int             = 0
    mom_delta_pct:    float           = 0.0
    top_services:     List[str]       = Field(default_factory=list)
    subscription_ids: List[str]       = Field(default_factory=list)


class FinOpsAllocationReport(BaseModel):
    dimension:          str                         = ""  # e.g. "SubscriptionId" | "ResourceGroupName" | "TagKey:CostCenter"
    dimension_label:    str                         = ""  # human-readable
    items:              List[FinOpsAllocationItem]  = Field(default_factory=list)
    total_usd:          float                       = 0.0
    unallocated_usd:    float                       = 0.0   # resources missing the group-by dimension (no tag value)
    unallocated_pct:    float                       = 0.0
    period_label:       str                         = ""
    date_from:          str                         = ""
    date_to:            str                         = ""
    data_source:        str                         = "azure_cost_management"


class FinOpsChargebackEntry(BaseModel):
    cost_center:         str              = "Unallocated"
    department:          str              = ""
    owner:               str              = ""
    allocated_cost_usd:  float            = 0.0
    resource_count:      int              = 0
    subscription_count:  int              = 0
    by_service:          Dict[str, float] = Field(default_factory=dict)   # service_family → cost
    coverage_pct:        float            = 100.0  # % of cost that has CostCenter tag


class FinOpsChargebackReport(BaseModel):
    entries:                List[FinOpsChargebackEntry]  = Field(default_factory=list)
    total_allocated_usd:    float                        = 0.0
    total_unallocated_usd:  float                        = 0.0
    coverage_pct:           float                        = 0.0
    period_label:           str                          = ""
    date_from:              str                          = ""
    date_to:                str                          = ""
    data_source:            str                          = "azure_cost_management"
    generated_at:           str                          = ""


# ── Commitments — Reservations & Savings Plans ─────────────────────────────────

class FinOpsReservationSummary(BaseModel):
    reservation_order_id:  str
    reservation_id:        str
    display_name:          str              = ""
    resource_type:         str              = ""  # e.g. "microsoft.compute/virtualmachines"
    region:                str              = ""
    sku:                   str              = ""
    term:                  str              = "P1Y"   # "P1Y" | "P3Y"
    term_label:            str              = "1 Year"
    quantity:              int              = 1
    monthly_cost_usd:      float            = 0.0
    utilization_pct:       float            = 0.0   # from Azure RI utilization API
    expiry_date:           str              = ""    # ISO date
    purchase_date:         str              = ""
    days_to_expiry:        int              = 0
    status:                str              = "active"  # "active" | "expiring_soon" | "expired" | "underutilized"
    covered_resource_ids:  List[str]        = Field(default_factory=list)
    scope:                 str              = "Shared"  # "Shared" | "Single"
    subscription_id:       str              = ""


class FinOpsSavingsPlanOption(BaseModel):
    """Azure RI buy recommendation — sourced from ConsumptionManagementClient.reservation_recommendations."""
    resource_type:           str    = ""
    region:                  str    = ""
    sku:                     str    = ""
    term:                    str    = "P1Y"
    term_label:              str    = "1 Year"
    lookback_period:         str    = "Last30Days"
    recommended_quantity:    int    = 1
    current_monthly_cost:    float  = 0.0
    commitment_monthly_cost: float  = 0.0
    monthly_savings:         float  = 0.0
    annual_savings:          float  = 0.0
    savings_pct:             float  = 0.0
    break_even_months:       int    = 0
    azure_confidence:        str    = "Medium"   # "High" | "Medium" | "Low" — from Azure API


class FinOpsCommitmentSummary(BaseModel):
    total_reserved_monthly_usd:   float                            = 0.0
    total_on_demand_monthly_usd:  float                            = 0.0
    coverage_pct:                 float                            = 0.0   # RI-covered / total eligible
    utilization_pct:              float                            = 0.0   # avg utilization across all RIs
    expiring_within_30d:          int                              = 0
    expiring_within_90d:          int                              = 0
    underutilized_count:          int                              = 0     # utilization < 80%
    reservations:                 List[FinOpsReservationSummary]   = Field(default_factory=list)
    savings_plan_options:         List[FinOpsSavingsPlanOption]    = Field(default_factory=list)
    generated_at:                 str                              = ""


# ── Tag Analytics ─────────────────────────────────────────────────────────────

class FinOpsTagKeyStats(BaseModel):
    tag_key:           str              = ""
    covered_resources: int              = 0
    total_resources:   int              = 0
    coverage_pct:      float            = 0.0
    total_cost_usd:    float            = 0.0   # cost of resources with this tag — from Azure cost query grouped by tag key
    distinct_values:   int              = 0
    top_values:        List[Dict]       = Field(default_factory=list)   # [{value, cost_usd, resource_count}]
    is_required:       bool             = False


class FinOpsTagCostMatrix(BaseModel):
    tag_key:           str              = ""
    rows:              List[Dict]       = Field(default_factory=list)  # [{tag_value, cost_usd, resource_count, pct}]
    total_usd:         float            = 0.0
    untagged_usd:      float            = 0.0   # cost without this tag key
    date_from:         str              = ""
    date_to:           str              = ""
    data_source:       str              = "azure_cost_management"


class FinOpsTagAnalyticsResult(BaseModel):
    tag_keys:              List[FinOpsTagKeyStats]  = Field(default_factory=list)
    untagged_cost_usd:     float                    = 0.0   # cost of resources with no tags at all
    untagged_resource_count: int                    = 0
    compliance_score_pct:  float                    = 0.0   # % resources with all required tags
    required_tags:         List[str]                = Field(default_factory=list)
    generated_at:          str                      = ""
    data_source:           str                      = "azure_cost_management"


# ── Savings Opportunities ─────────────────────────────────────────────────────

class FinOpsSavingsOpportunity(BaseModel):
    id:                   str              = ""
    category:             str              = ""   # "rightsize" | "ri_purchase" | "waste" | "orphan" | "license" | "modernization"
    category_label:       str              = ""
    resource_id:          str              = ""
    resource_name:        str              = ""
    resource_type:        str              = ""
    resource_group:       str              = ""
    subscription_id:      str              = ""
    current_monthly_cost: float            = 0.0
    potential_savings_usd: float           = 0.0
    savings_pct:          float            = 0.0
    confidence:           str              = "medium"   # "high" | "medium" | "low"
    effort:               str              = "medium"   # "low" | "medium" | "high"
    action:               str              = ""
    priority_score:       float            = 0.0   # 0-100 composite (savings × confidence / effort)
    source:               str              = ""   # "azure_advisor" | "rightsize_analysis" | "scoring_engine" | "ri_recommendation"


class FinOpsSavingsSummary(BaseModel):
    total_identified_usd:  float                          = 0.0
    by_category:           Dict[str, float]               = Field(default_factory=dict)
    opportunity_count:     int                            = 0
    opportunities:         List[FinOpsSavingsOpportunity] = Field(default_factory=list)
    generated_at:          str                            = ""


# ── Top Movers ────────────────────────────────────────────────────────────────

class FinOpsTopMover(BaseModel):
    subscription_id:   str    = ""
    subscription_name: str    = ""
    resource_group:    str    = ""
    dimension_value:   str    = ""   # e.g. resource name or service name
    dimension:         str    = ""
    current_cost:      float  = 0.0
    prior_cost:        float  = 0.0
    delta_usd:         float  = 0.0
    delta_pct:         float  = 0.0
    direction:         str    = "up"   # "up" | "down"


# ── FinOps KPI ────────────────────────────────────────────────────────────────

class FinOpsKPI(BaseModel):
    """Executive-level FinOps KPIs — all sourced from live Azure Cost Management API."""
    total_spend_mtd:          float   = 0.0   # current month to date
    total_spend_last_month:   float   = 0.0
    mom_delta_usd:            float   = 0.0
    mom_delta_pct:            float   = 0.0
    forecast_eom_usd:         float   = 0.0   # end-of-month projection
    budget_utilization_pct:   float   = 0.0   # aggregate across all budgets
    budgets_exceeded:         int     = 0
    budgets_at_risk:          int     = 0     # 75–100%
    savings_identified_usd:   float   = 0.0
    ri_coverage_pct:          float   = 0.0
    ri_utilization_pct:       float   = 0.0
    tagging_compliance_pct:   float   = 0.0
    total_untagged:           int     = 0
    tag_required_keys:        List[str]              = Field(default_factory=list)
    has_reservations:         bool    = False   # any active/billed reservations present
    has_budgets:              bool    = False   # any budgets defined (user or Azure-native)
    anomaly_count:            int     = 0
    top_subscription_name:    str     = ""
    top_subscription_cost:    float   = 0.0
    cost_trend_30d:           List[float]            = Field(default_factory=list)   # daily spend, 30 days
    cost_trend_dates:         List[str]              = Field(default_factory=list)   # calendar dates parallel to cost_trend_30d
    by_subscription:          List[Dict[str, Any]]   = Field(default_factory=list)   # [{id, name, cost}] sorted by cost
    subscription_count:       int     = 0
    total_resource_count:     int     = 0
    data_source:              str     = "azure_cost_management"
    generated_at:             str     = ""
