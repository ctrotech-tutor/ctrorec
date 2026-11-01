CREATE TABLE "academic_terms" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"institution_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"status" text DEFAULT 'planned' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "academic_terms_institution_code_unique" UNIQUE("institution_id","code"),
	CONSTRAINT "academic_terms_id_institution_unique" UNIQUE("id","institution_id"),
	CONSTRAINT "academic_terms_dates_valid" CHECK ("academic_terms"."ends_on" >= "academic_terms"."starts_on"),
	CONSTRAINT "academic_terms_fields_valid" CHECK (btrim("academic_terms"."name") <> '' AND btrim("academic_terms"."code") <> '' AND "academic_terms"."code" = upper(btrim("academic_terms"."code"))),
	CONSTRAINT "academic_terms_status_valid" CHECK ("academic_terms"."status" IN ('planned', 'active', 'completed', 'archived'))
);
--> statement-breakpoint
CREATE TABLE "academic_units" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"institution_id" uuid NOT NULL,
	"parent_id" uuid,
	"kind" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "academic_units_institution_code_unique" UNIQUE("institution_id","code"),
	CONSTRAINT "academic_units_id_institution_unique" UNIQUE("id","institution_id"),
	CONSTRAINT "academic_units_not_own_parent" CHECK ("academic_units"."parent_id" IS NULL OR "academic_units"."parent_id" <> "academic_units"."id"),
	CONSTRAINT "academic_units_fields_valid" CHECK (btrim("academic_units"."kind") <> '' AND btrim("academic_units"."name") <> '' AND btrim("academic_units"."code") <> '' AND "academic_units"."code" = upper(btrim("academic_units"."code")))
);
--> statement-breakpoint
CREATE TABLE "course_offerings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"institution_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"term_id" uuid NOT NULL,
	"section" text DEFAULT 'main' NOT NULL,
	"status" text DEFAULT 'planned' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "course_offerings_course_term_section_unique" UNIQUE("institution_id","course_id","term_id","section"),
	CONSTRAINT "course_offerings_id_institution_unique" UNIQUE("id","institution_id"),
	CONSTRAINT "course_offerings_section_nonempty" CHECK (btrim("course_offerings"."section") <> ''),
	CONSTRAINT "course_offerings_status_valid" CHECK ("course_offerings"."status" IN ('planned', 'active', 'completed', 'archived'))
);
--> statement-breakpoint
CREATE TABLE "courses" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"institution_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"code" text NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "courses_institution_code_unique" UNIQUE("institution_id","code"),
	CONSTRAINT "courses_id_institution_unique" UNIQUE("id","institution_id"),
	CONSTRAINT "courses_fields_valid" CHECK (btrim("courses"."title") <> '' AND btrim("courses"."code") <> '' AND "courses"."code" = upper(btrim("courses"."code")))
);
--> statement-breakpoint
CREATE TABLE "institutions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "institutions_slug_unique" UNIQUE("slug"),
	CONSTRAINT "institutions_slug_format" CHECK ("institutions"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "institutions_name_nonempty" CHECK (btrim("institutions"."name") <> ''),
	CONSTRAINT "institutions_status_valid" CHECK ("institutions"."status" IN ('active', 'suspended', 'archived'))
);
--> statement-breakpoint
CREATE TABLE "membership_roles" (
	"institution_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "membership_roles_pkey" PRIMARY KEY("institution_id","membership_id","role"),
	CONSTRAINT "membership_roles_role_valid" CHECK ("membership_roles"."role" IN ('institution_admin', 'academic_staff', 'student'))
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"institution_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_institution_user_unique" UNIQUE("institution_id","user_id"),
	CONSTRAINT "memberships_id_institution_unique" UNIQUE("id","institution_id"),
	CONSTRAINT "memberships_status_valid" CHECK ("memberships"."status" IN ('active', 'suspended'))
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_email_normalized" CHECK ("users"."email" = lower(btrim("users"."email")) AND position('@' IN "users"."email") > 1),
	CONSTRAINT "users_display_name_nonempty" CHECK (btrim("users"."display_name") <> ''),
	CONSTRAINT "users_status_valid" CHECK ("users"."status" IN ('invited', 'active', 'suspended'))
);
--> statement-breakpoint
CREATE TABLE "enrollments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"institution_id" uuid NOT NULL,
	"course_offering_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"enrolled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ends_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "enrollments_id_institution_unique" UNIQUE("id","institution_id"),
	CONSTRAINT "enrollments_dates_valid" CHECK ("enrollments"."ends_at" IS NULL OR "enrollments"."ends_at" > "enrollments"."enrolled_at")
);
--> statement-breakpoint
CREATE TABLE "lecturer_assignments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"institution_id" uuid NOT NULL,
	"course_offering_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"role" text DEFAULT 'lead' NOT NULL,
	"starts_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ends_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lecturer_assignments_id_institution_unique" UNIQUE("id","institution_id"),
	CONSTRAINT "lecturer_assignments_role_valid" CHECK ("lecturer_assignments"."role" IN ('lead', 'assistant', 'guest')),
	CONSTRAINT "lecturer_assignments_dates_valid" CHECK ("lecturer_assignments"."ends_at" IS NULL OR "lecturer_assignments"."ends_at" > "lecturer_assignments"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "lectures" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"institution_id" uuid NOT NULL,
	"course_offering_id" uuid NOT NULL,
	"created_by_membership_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lectures_id_institution_unique" UNIQUE("id","institution_id"),
	CONSTRAINT "lectures_title_nonempty" CHECK (btrim("lectures"."title") <> ''),
	CONSTRAINT "lectures_status_valid" CHECK ("lectures"."status" IN ('draft', 'published', 'archived')),
	CONSTRAINT "lectures_publish_time_required" CHECK ("lectures"."status" <> 'published' OR "lectures"."published_at" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "academic_terms" ADD CONSTRAINT "academic_terms_institution_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic_units" ADD CONSTRAINT "academic_units_institution_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic_units" ADD CONSTRAINT "academic_units_parent_fk" FOREIGN KEY ("parent_id","institution_id") REFERENCES "public"."academic_units"("id","institution_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_offerings" ADD CONSTRAINT "course_offerings_institution_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_offerings" ADD CONSTRAINT "course_offerings_course_fk" FOREIGN KEY ("course_id","institution_id") REFERENCES "public"."courses"("id","institution_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_offerings" ADD CONSTRAINT "course_offerings_term_fk" FOREIGN KEY ("term_id","institution_id") REFERENCES "public"."academic_terms"("id","institution_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courses" ADD CONSTRAINT "courses_institution_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courses" ADD CONSTRAINT "courses_unit_fk" FOREIGN KEY ("unit_id","institution_id") REFERENCES "public"."academic_units"("id","institution_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_roles" ADD CONSTRAINT "membership_roles_membership_fk" FOREIGN KEY ("membership_id","institution_id") REFERENCES "public"."memberships"("id","institution_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_institution_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_institution_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_offering_fk" FOREIGN KEY ("course_offering_id","institution_id") REFERENCES "public"."course_offerings"("id","institution_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_membership_fk" FOREIGN KEY ("membership_id","institution_id") REFERENCES "public"."memberships"("id","institution_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lecturer_assignments" ADD CONSTRAINT "lecturer_assignments_institution_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lecturer_assignments" ADD CONSTRAINT "lecturer_assignments_offering_fk" FOREIGN KEY ("course_offering_id","institution_id") REFERENCES "public"."course_offerings"("id","institution_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lecturer_assignments" ADD CONSTRAINT "lecturer_assignments_membership_fk" FOREIGN KEY ("membership_id","institution_id") REFERENCES "public"."memberships"("id","institution_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lectures" ADD CONSTRAINT "lectures_institution_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lectures" ADD CONSTRAINT "lectures_offering_fk" FOREIGN KEY ("course_offering_id","institution_id") REFERENCES "public"."course_offerings"("id","institution_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lectures" ADD CONSTRAINT "lectures_creator_fk" FOREIGN KEY ("created_by_membership_id","institution_id") REFERENCES "public"."memberships"("id","institution_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "academic_units_parent_idx" ON "academic_units" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "course_offerings_term_idx" ON "course_offerings" USING btree ("term_id");--> statement-breakpoint
CREATE INDEX "courses_unit_idx" ON "courses" USING btree ("unit_id");--> statement-breakpoint
CREATE INDEX "memberships_user_idx" ON "memberships" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "enrollments_active_unique" ON "enrollments" USING btree ("course_offering_id","membership_id") WHERE "enrollments"."ends_at" IS NULL;--> statement-breakpoint
CREATE INDEX "enrollments_membership_idx" ON "enrollments" USING btree ("membership_id","ends_at");--> statement-breakpoint
CREATE UNIQUE INDEX "lecturer_assignments_active_unique" ON "lecturer_assignments" USING btree ("course_offering_id","membership_id") WHERE "lecturer_assignments"."ends_at" IS NULL;--> statement-breakpoint
CREATE INDEX "lecturer_assignments_membership_idx" ON "lecturer_assignments" USING btree ("membership_id","ends_at");--> statement-breakpoint
CREATE INDEX "lectures_offering_status_date_idx" ON "lectures" USING btree ("course_offering_id","status","occurred_at");--> statement-breakpoint
CREATE INDEX "lectures_creator_idx" ON "lectures" USING btree ("created_by_membership_id");