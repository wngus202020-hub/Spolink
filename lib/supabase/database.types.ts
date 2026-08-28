// allow: SIZE_OK - Supabase schema type map mirrors the MVP migration.
export type Json =
  | boolean
  | null
  | number
  | string
  | readonly Json[]
  | { readonly [key: string]: Json | undefined }

type Table<Row, Insert, Update = Partial<Row>> = Readonly<{
  Insert: Insert
  Relationships: []
  Row: Row
  Update: Update
}>
type InsertShape<Row, RequiredKeys extends keyof Row> = Readonly<
  Pick<Row, RequiredKeys> & Partial<Omit<Row, RequiredKeys>>
>
type NoArgs = Record<string, never>
type Rpc<Args, Returns> = Readonly<{
  Args: Args
  Returns: Returns
}>

type Uuid = string
type Timestamp = string

type BaseTimestamps = Readonly<{
  created_at: Timestamp
  updated_at: Timestamp
}>

type UserStatus = "active" | "pending_coach" | "coach_approved" | "suspended" | "deleted"
type UserRole = "learner" | "coach" | "admin"
type CoachStatus = "draft" | "submitted" | "approved" | "rejected" | "suspended"
type LessonStatus = "draft" | "pending_review" | "active" | "paused" | "closed" | "rejected"
type LessonImageLifecycleState = "deleting" | "ready"
type LessonImageUploadIntentStatus = "cancelled" | "claimed" | "cleaned" | "pending" | "registered"
type ReservationStatus =
  | "pending_payment"
  | "confirmed"
  | "cancelled_by_user"
  | "cancelled_by_coach"
  | "cancelled_by_admin"
  | "completed"
  | "no_show_user"
  | "no_show_coach"
  | "disputed"
type PaymentStatus = "ready" | "paid" | "failed" | "cancelled" | "partially_refunded" | "refunded"
type SettlementStatus = "pending" | "hold" | "approved" | "paid" | "failed"
type ReviewStatus = "visible" | "hidden" | "deleted"
type ReportStatus = "submitted" | "reviewing" | "resolved" | "rejected"
type RefundStatus = "requested" | "approved" | "failed" | "completed"
type RefundSource = "manual" | "payment_confirmation_reconciliation" | "reservation_cancellation"
type LessonStatusAction = "approve" | "close" | "pause" | "reject" | "resume" | "submit"
type ReservationStatusAction =
  | "cancel"
  | "complete"
  | "mark_coach_no_show"
  | "mark_learner_no_show"
  | "open_dispute"
type ReportStatusAction = "reject" | "resolve" | "start_review"
type SettlementStatusAction = "approve" | "hold"
type RefundResultAction = "complete" | "fail"
type ReportTargetType = "coach" | "lesson" | "reservation" | "review" | "user"
type NotificationType =
  | "coach_certification.reviewed"
  | "coach_certification.submitted"
  | "refund.result"
  | "report.resolved"
  | "reservation.completed"
  | "reservation.no_show"
  | "reservation_cancelled"
  | "reservation_confirmed"
  | "review.requested"
  | "settlement.status_changed"

type ProfilesRow = BaseTimestamps &
  Readonly<{
    avatar_path: string | null
    default_region: string | null
    deleted_at: Timestamp | null
    display_name: string
    id: Uuid
    location_agreed_at: Timestamp | null
    marketing_agreed_at: Timestamp | null
    phone: string | null
    real_name: string | null
    role: UserRole
    status: UserStatus
  }>
type ProfilesInsert = InsertShape<ProfilesRow, "display_name" | "id">

type SportsRow = BaseTimestamps &
  Readonly<{ id: Uuid; is_active: boolean; name: string; slug: string }>
type SportsInsert = InsertShape<SportsRow, "name" | "slug">

type CoachProfilesRow = BaseTimestamps &
  Readonly<{
    bank_account_last4: string | null
    bank_name: string | null
    bio: string | null
    career_years: number
    headline: string | null
    id: Uuid
    intro_video_url: string | null
    payout_holder_name: string | null
    primary_sport_id: Uuid | null
    rejection_reason: string | null
    reviewed_at: Timestamp | null
    reviewed_by: Uuid | null
    service_region: string
    status: CoachStatus
    submitted_at: Timestamp | null
    user_id: Uuid
  }>
type CoachProfilesInsert = InsertShape<CoachProfilesRow, "service_region" | "user_id">

type CoachCertificatesRow = BaseTimestamps &
  Readonly<{
    certificate_name: string
    certificate_number: string | null
    coach_profile_id: Uuid
    file_path: string
    id: Uuid
    issuer: string | null
    rejected_reason: string | null
    verified_at: Timestamp | null
  }>
type CoachCertificatesInsert = InsertShape<
  CoachCertificatesRow,
  "certificate_name" | "coach_profile_id" | "file_path"
>

type LessonsRow = BaseTimestamps &
  Readonly<{
    address: string | null
    cancellation_policy_summary: string | null
    capacity: number
    coach_profile_id: Uuid
    description: string
    duration_minutes: number
    id: Uuid
    latitude: number | null
    longitude: number | null
    paused_reason: string | null
    place_name: string | null
    preparation: string | null
    price_amount: number
    region: string
    sport_id: Uuid
    status: LessonStatus
    summary: string | null
    title: string
  }>
type LessonsInsert = InsertShape<
  LessonsRow,
  | "coach_profile_id"
  | "description"
  | "duration_minutes"
  | "price_amount"
  | "region"
  | "sport_id"
  | "title"
>

type LessonImagesRow = Readonly<{
  created_at: Timestamp
  file_path: string
  id: Uuid
  lesson_id: Uuid
  lifecycle_state: LessonImageLifecycleState
  sort_order: number
}>
type LessonImagesInsert = InsertShape<LessonImagesRow, "file_path" | "lesson_id">

type LessonImageDeletionReceiptsRow = Readonly<{
  coach_profile_id: Uuid
  created_at: Timestamp
  file_path: string
  image_id: Uuid
  lesson_id: Uuid
  user_id: Uuid
}>
type LessonImageDeletionReceiptsInsert = InsertShape<
  LessonImageDeletionReceiptsRow,
  "coach_profile_id" | "file_path" | "image_id" | "lesson_id" | "user_id"
>

type LessonImageUploadIntentsRow = BaseTimestamps &
  Readonly<{
    claim_token: Uuid | null
    claimed_at: Timestamp | null
    coach_profile_id: Uuid
    completed_at: Timestamp | null
    expires_at: Timestamp
    id: Uuid
    lesson_id: Uuid
    mime_type: "image/jpeg" | "image/png" | "image/webp"
    object_name: string
    registered_image_id: Uuid | null
    size_bytes: number
    status: LessonImageUploadIntentStatus
    user_id: Uuid
  }>
type LessonImageUploadIntentsInsert = InsertShape<
  LessonImageUploadIntentsRow,
  "coach_profile_id" | "lesson_id" | "mime_type" | "object_name" | "size_bytes" | "user_id"
>

type LessonSchedulesRow = BaseTimestamps &
  Readonly<{
    capacity: number
    ends_at: Timestamp
    id: Uuid
    is_open: boolean
    lesson_id: Uuid
    reserved_count: number
    starts_at: Timestamp
  }>
type LessonSchedulesInsert = InsertShape<
  LessonSchedulesRow,
  "capacity" | "ends_at" | "lesson_id" | "starts_at"
>

type ReservationsRow = BaseTimestamps &
  Readonly<{
    cancellation_reason: string | null
    cancelled_at: Timestamp | null
    coach_profile_id: Uuid
    completed_at: Timestamp | null
    confirmed_at: Timestamp | null
    dispute_reason: string | null
    id: Uuid
    learner_id: Uuid
    lesson_id: Uuid
    lesson_schedule_id: Uuid
    no_show_marked_at: Timestamp | null
    payment_expires_at: Timestamp | null
    reserved_price_amount: number
    status: ReservationStatus
  }>
type ReservationsInsert = InsertShape<
  ReservationsRow,
  "coach_profile_id" | "learner_id" | "lesson_id" | "lesson_schedule_id" | "reserved_price_amount"
>

type PaymentsRow = BaseTimestamps &
  Readonly<{
    amount: number
    approved_at: Timestamp | null
    failed_reason: string | null
    id: Uuid
    payer_id: Uuid
    provider: string
    provider_order_id: string
    provider_payment_key: string | null
    raw_payload: Json | null
    reservation_id: Uuid
    status: PaymentStatus
  }>
type PaymentsInsert = InsertShape<
  PaymentsRow,
  "amount" | "payer_id" | "provider_order_id" | "reservation_id"
>

type RefundsRow = BaseTimestamps &
  Readonly<{
    amount: number
    claim_attempt: number
    claim_expires_at: Timestamp | null
    claim_idempotency_key: string | null
    claim_token: Uuid | null
    claimed_at: Timestamp | null
    id: Uuid
    payment_id: Uuid
    processed_at: Timestamp | null
    provider_refund_key: string | null
    raw_payload: Json | null
    reason: string
    requested_by: Uuid
    result_fingerprint: string | null
    reservation_id: Uuid
    source: RefundSource
    status: RefundStatus
    last_failure_code: string | null
  }>
type RefundsInsert = InsertShape<
  RefundsRow,
  "amount" | "payment_id" | "reason" | "requested_by" | "reservation_id"
>

type SettlementsRow = BaseTimestamps &
  Readonly<{
    approved_at: Timestamp | null
    coach_profile_id: Uuid
    gross_amount: number
    hold_reason: string | null
    id: Uuid
    net_amount: number
    paid_at: Timestamp | null
    payment_fee_amount: number
    payment_id: Uuid
    platform_fee_amount: number
    refund_amount: number
    reservation_id: Uuid
    status: SettlementStatus
  }>
type SettlementsInsert = InsertShape<
  SettlementsRow,
  "coach_profile_id" | "gross_amount" | "net_amount" | "payment_id" | "reservation_id"
>

type ReviewsRow = BaseTimestamps &
  Readonly<{
    coach_profile_id: Uuid
    content: string | null
    hidden_reason: string | null
    id: Uuid
    lesson_id: Uuid
    rating: number
    reservation_id: Uuid
    reviewer_id: Uuid
    status: ReviewStatus
  }>
type ReviewsInsert = InsertShape<
  ReviewsRow,
  "coach_profile_id" | "lesson_id" | "rating" | "reservation_id" | "reviewer_id"
>

type LessonFavoritesRow = Readonly<{
  created_at: Timestamp
  id: Uuid
  learner_id: Uuid
  lesson_id: Uuid
}>
type LessonFavoritesInsert = InsertShape<LessonFavoritesRow, "learner_id" | "lesson_id">

type ReportsRow = BaseTimestamps &
  Readonly<{
    detail: string | null
    id: Uuid
    reason: string
    reporter_id: Uuid
    resolution_note: string | null
    reviewed_at: Timestamp | null
    reviewed_by: Uuid | null
    status: ReportStatus
    target_id: Uuid
    target_type: ReportTargetType
  }>
type ReportsInsert = InsertShape<ReportsRow, "reason" | "reporter_id" | "target_id" | "target_type">

type BlocksRow = Readonly<{
  blocked_id: Uuid
  blocker_id: Uuid
  created_at: Timestamp
  id: Uuid
  reason: string | null
}>
type BlocksInsert = InsertShape<BlocksRow, "blocked_id" | "blocker_id">

type NotificationsRow = Readonly<{
  body: string | null
  created_at: Timestamp
  data: Json | null
  event_key: string | null
  id: Uuid
  read_at: Timestamp | null
  title: string
  type: NotificationType
  user_id: Uuid
}>
type NotificationsInsert = InsertShape<NotificationsRow, "title" | "type" | "user_id">

type AuditLogsRow = Readonly<{
  action: string
  actor_id: Uuid | null
  after_data: Json | null
  before_data: Json | null
  created_at: Timestamp
  id: Uuid
  target_id: Uuid
  target_type: string
}>
type AuditLogsInsert = InsertShape<AuditLogsRow, "action" | "target_id" | "target_type">

type CoachProfilePublicCardsRow = Readonly<
  Pick<
    CoachProfilesRow,
    | "bio"
    | "career_years"
    | "created_at"
    | "headline"
    | "id"
    | "intro_video_url"
    | "primary_sport_id"
    | "service_region"
    | "updated_at"
  >
>

export type Database = Readonly<{
  public: {
    CompositeTypes: Record<string, never>
    Enums: {
      coach_status: CoachStatus
      lesson_status_action: LessonStatusAction
      lesson_status: LessonStatus
      notification_type: NotificationType
      payment_status: PaymentStatus
      refund_result_action: RefundResultAction
      refund_status: RefundStatus
      report_status_action: ReportStatusAction
      report_status: ReportStatus
      report_target_type: ReportTargetType
      reservation_status_action: ReservationStatusAction
      reservation_status: ReservationStatus
      review_status: ReviewStatus
      settlement_status_action: SettlementStatusAction
      settlement_status: SettlementStatus
      user_role: UserRole
      user_status: UserStatus
    }
    Functions: {
      upsert_coach_application_draft: Rpc<
        {
          checked_bank_account_last4: string
          checked_bank_name: string
          checked_bio: string
          checked_career_years: number
          checked_headline: string
          checked_payout_holder_name: string
          checked_primary_sport_id: Uuid
          checked_service_region: string
        },
        readonly CoachProfilesRow[]
      >
      submit_coach_application: Rpc<
        NoArgs,
        readonly Readonly<{
          coach_status: "submitted"
          profile_role: "learner"
          profile_status: "pending_coach"
          submitted_at: Timestamp
        }>[]
      >
      consume_password_recovery_grant: Rpc<
        {
          checked_token_hash: string
        },
        boolean
      >
      calculate_cancellation_refund: Rpc<
        {
          checked_amount: number
          checked_cancelled_at: Timestamp
          checked_starts_at: Timestamp
          checked_status: ReservationStatus
        },
        number
      >
      claim_refund: Rpc<
        { checked_idempotency_key: string; checked_refund_id: Uuid },
        readonly Readonly<{
          attempt: number
          claim_token: Uuid
          idempotent: boolean
          refund_id: Uuid
          status: RefundStatus
        }>[]
      >
      process_refund_result: Rpc<
        {
          checked_action: RefundResultAction
          checked_claim_token?: Uuid | null
          checked_failure_code?: string | null
          checked_provider_refund_key?: string | null
          checked_raw_payload?: Json | null
          checked_refund_id: Uuid
        },
        readonly Readonly<{ idempotent: boolean; refund_id: Uuid; status: RefundStatus }>[]
      >
      generate_settlement: Rpc<
        { checked_reservation_id: Uuid },
        readonly Readonly<{ idempotent: boolean; settlement_id: Uuid; status: SettlementStatus }>[]
      >
      set_settlement_status: Rpc<
        {
          checked_action: SettlementStatusAction
          checked_hold_reason?: string | null
          checked_settlement_id: Uuid
        },
        readonly Readonly<{ idempotent: boolean; settlement_id: Uuid; status: SettlementStatus }>[]
      >
      cancel_reservation: Rpc<
        {
          checked_reason: string
          checked_reservation_id: Uuid
        },
        readonly Readonly<{
          cancelled_at: Timestamp
          refund_amount: number | null
          refund_id: Uuid | null
          refund_status: RefundStatus | null
          reservation_id: Uuid
          reservation_status: ReservationStatus
        }>[]
      >
      transition_reservation: Rpc<
        {
          checked_action: ReservationStatusAction
          checked_reason?: string | null
          checked_reservation_id: Uuid
        },
        readonly Readonly<{
          cancelled_at: Timestamp | null
          refund_amount: number | null
          refund_id: Uuid | null
          refund_status: RefundStatus | null
          reservation_id: Uuid
          reservation_status: ReservationStatus
        }>[]
      >
      transition_reservation_lifecycle: Rpc<
        {
          checked_action: ReservationStatusAction
          checked_reason?: string | null
          checked_reservation_id: Uuid
        },
        readonly Readonly<{
          cancelled_at: Timestamp | null
          completed_at: Timestamp | null
          no_show_marked_at: Timestamp | null
          refund_amount: number | null
          refund_id: Uuid | null
          refund_status: RefundStatus | null
          reservation_id: Uuid
          reservation_status: ReservationStatus
          settlement_id: Uuid | null
        }>[]
      >
      transition_admin_reservation: Rpc<
        {
          checked_action: ReservationStatusAction
          checked_reason?: string | null
          checked_reservation_id: Uuid
        },
        readonly Readonly<{
          cancelled_at: Timestamp | null
          completed_at: Timestamp | null
          idempotent: boolean
          no_show_marked_at: Timestamp | null
          refund_amount: number | null
          refund_id: Uuid | null
          refund_status: RefundStatus | null
          reservation_id: Uuid
          reservation_status: ReservationStatus
          settlement_id: Uuid | null
        }>[]
      >
      confirm_paid_reservation: Rpc<
        {
          checked_amount: number
          checked_provider_order_id: string
          checked_provider_payment_key: string
          checked_raw_payload: Json
          checked_reservation_id: Uuid
        },
        readonly Readonly<{
          payment_id: Uuid
          reservation_id: Uuid
        }>[]
      >
      mark_payment_confirmation_failed: Rpc<
        {
          checked_failed_reason: string
          checked_provider_order_id: string
          checked_raw_payload: Json
          checked_reservation_id: Uuid
        },
        undefined
      >
      mark_payment_confirmation_reconciliation_required: Rpc<
        {
          checked_failure_code: string
          checked_provider_order_id: string
          checked_provider_payment_key: string
          checked_raw_payload: Json
          checked_reservation_id: Uuid
        },
        undefined
      >
      create_ready_payment: Rpc<
        {
          checked_reservation_id: Uuid
        },
        readonly Readonly<{
          amount: number
          order_name: string
          payment_id: Uuid
          provider: string
          provider_order_id: string
        }>[]
      >
      create_pending_reservation: Rpc<
        {
          checked_lesson_id: Uuid
          checked_schedule_id: Uuid
        },
        ReservationsRow
      >
      create_lesson_image_upload_intent: Rpc<
        {
          checked_lesson_id: Uuid
          checked_mime_type: string
          checked_size_bytes: number
        },
        readonly LessonImageUploadIntentsRow[]
      >
      cancel_lesson_image_upload_intent: Rpc<
        {
          checked_intent_id: Uuid
          checked_lesson_id: Uuid
          checked_object_name: string
        },
        readonly LessonImageUploadIntentsRow[]
      >
      register_validated_lesson_image: Rpc<
        { checked_actor_id: Uuid; checked_intent_id: Uuid; checked_object_name: string },
        readonly LessonImagesRow[]
      >
      reorder_lesson_images: Rpc<
        {
          checked_expected_image_ids: readonly Uuid[]
          checked_lesson_id: Uuid
          checked_ordered_image_ids: readonly Uuid[]
        },
        readonly LessonImagesRow[]
      >
      begin_delete_lesson_image: Rpc<
        {
          checked_expected_image_ids: readonly Uuid[]
          checked_image_id: Uuid
          checked_lesson_id: Uuid
        },
        readonly Readonly<{ file_path: string }>[]
      >
      finalize_delete_lesson_image: Rpc<
        { checked_image_id: Uuid; checked_lesson_id: Uuid },
        readonly LessonImagesRow[]
      >
      claim_expired_lesson_image_upload_intents: Rpc<
        { checked_limit?: number },
        readonly LessonImageUploadIntentsRow[]
      >
      finalize_lesson_image_upload_intent_cleanup: Rpc<
        {
          checked_claim_token: Uuid
          checked_cleaned: boolean
          checked_intent_id: Uuid
        },
        readonly LessonImageUploadIntentsRow[]
      >
      issue_password_recovery_grant: Rpc<
        {
          checked_expires_at: Timestamp
          checked_token_hash: string
        },
        boolean
      >
      can_create_review: Rpc<
        {
          checked_coach_profile_id: Uuid
          checked_lesson_id: Uuid
          checked_reservation_id: Uuid
          checked_reviewer_id: Uuid
        },
        boolean
      >
      create_review: Rpc<
        { checked_content: string; checked_rating: number; checked_reservation_id: Uuid },
        Readonly<{
          content: string | null
          created_at: Timestamp
          idempotent: boolean
          lesson_id: Uuid
          rating: number
          reservation_id: Uuid
          review_id: Uuid
        }>[]
      >
      can_view_reservation: Rpc<{ reservation_id: Uuid }, boolean>
      current_user_role: Rpc<NoArgs, UserRole | null>
      is_admin: Rpc<NoArgs, boolean>
      is_approved_coach: Rpc<{ checked_coach_profile_id: Uuid }, boolean>
      hide_review: Rpc<
        { checked_reason?: string; checked_review_id: Uuid },
        Readonly<{
          hidden_reason: string | null
          idempotent: boolean
          review_id: Uuid
          status: ReviewStatus
        }>[]
      >
      lesson_is_public: Rpc<{ checked_lesson_id: Uuid }, boolean>
      no_show_wait_interval: Rpc<NoArgs, string>
      notification_data_is_safe: Rpc<
        { checked_data: Json; checked_type: NotificationType },
        boolean
      >
      emit_notification_once: Rpc<
        {
          checked_body?: string | null
          checked_data: Json
          checked_event_key: string
          checked_title: string
          checked_type: NotificationType
          checked_user_id: Uuid
        },
        Readonly<{ idempotent: boolean; notification_id: Uuid }>[]
      >
      owns_coach_profile: Rpc<{ coach_profile_id: Uuid }, boolean>
      owns_lesson: Rpc<{ lesson_id: Uuid }, boolean>
      reservation_no_show_available_at: Rpc<{ checked_starts_at: Timestamp }, Timestamp>
      review_coach_application: Rpc<
        {
          checked_coach_profile_id: Uuid
          checked_decision: "approve" | "reject"
          checked_rejection_reason?: string | null
        },
        Readonly<{
          coach_profile_id: Uuid
          coach_status: CoachStatus
          idempotent: boolean
          profile_status: UserStatus
          reviewed_at: Timestamp
        }>[]
      >
      protect_certificate_review_fields: Rpc<NoArgs, unknown>
      protect_coach_review_fields: Rpc<NoArgs, unknown>
      protect_lesson_review_status: Rpc<NoArgs, unknown>
      protect_notification_read_update: Rpc<NoArgs, unknown>
      protect_profile_system_fields: Rpc<NoArgs, unknown>
      protect_reservation_transition_fields: Rpc<NoArgs, unknown>
      protect_schedule_transition_fields: Rpc<NoArgs, unknown>
      set_updated_at: Rpc<NoArgs, unknown>
    }
    Tables: {
      audit_logs: Table<AuditLogsRow, AuditLogsInsert>
      blocks: Table<BlocksRow, BlocksInsert>
      coach_certificates: Table<CoachCertificatesRow, CoachCertificatesInsert>
      coach_profiles: Table<CoachProfilesRow, CoachProfilesInsert>
      lesson_favorites: Table<LessonFavoritesRow, LessonFavoritesInsert>
      lesson_image_deletion_receipts: Table<
        LessonImageDeletionReceiptsRow,
        LessonImageDeletionReceiptsInsert
      >
      lesson_image_upload_intents: Table<
        LessonImageUploadIntentsRow,
        LessonImageUploadIntentsInsert
      >
      lesson_images: Table<LessonImagesRow, LessonImagesInsert>
      lesson_schedules: Table<LessonSchedulesRow, LessonSchedulesInsert>
      lessons: Table<LessonsRow, LessonsInsert>
      notifications: Table<NotificationsRow, NotificationsInsert>
      payments: Table<PaymentsRow, PaymentsInsert>
      profiles: Table<ProfilesRow, ProfilesInsert>
      refunds: Table<RefundsRow, RefundsInsert>
      reports: Table<ReportsRow, ReportsInsert>
      reservations: Table<ReservationsRow, ReservationsInsert>
      reviews: Table<ReviewsRow, ReviewsInsert>
      settlements: Table<SettlementsRow, SettlementsInsert>
      sports: Table<SportsRow, SportsInsert>
    }
    Views: {
      coach_profile_public_cards: Table<CoachProfilePublicCardsRow, never, never>
    }
  }
}>
