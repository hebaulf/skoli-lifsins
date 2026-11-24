CREATE TYPE "public"."user_role" AS ENUM('student', 'teacher', 'admin');--> statement-breakpoint
CREATE TABLE "answer_key" (
	"question_id" text PRIMARY KEY NOT NULL,
	"correct_option_id" text NOT NULL,
	"explanation" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chapter_progress" (
	"user_id" text NOT NULL,
	"chapter_id" text NOT NULL,
	"best_correct_count" integer NOT NULL,
	"question_count" integer NOT NULL,
	"passed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chapter_progress_user_id_chapter_id_pk" PRIMARY KEY("user_id","chapter_id"),
	CONSTRAINT "chapter_progress_counts_valid" CHECK ("chapter_progress"."question_count" > 0 AND "chapter_progress"."best_correct_count" >= 0 AND "chapter_progress"."best_correct_count" <= "chapter_progress"."question_count")
);
--> statement-breakpoint
CREATE TABLE "diploma" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"verification_id" text NOT NULL,
	"overall_correct_count" integer NOT NULL,
	"overall_question_count" integer NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "diploma_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "diploma_verification_id_unique" UNIQUE("verification_id"),
	CONSTRAINT "diploma_counts_valid" CHECK ("diploma"."overall_question_count" > 0 AND "diploma"."overall_correct_count" >= 0 AND "diploma"."overall_correct_count" <= "diploma"."overall_question_count")
);
--> statement-breakpoint
CREATE TABLE "group_membership" (
	"group_id" uuid NOT NULL,
	"student_id" text NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "group_membership_group_id_student_id_pk" PRIMARY KEY("group_id","student_id"),
	CONSTRAINT "group_membership_one_group_per_student" UNIQUE("student_id")
);
--> statement-breakpoint
CREATE TABLE "invitation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"email" text,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitation_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "quiz_attempt" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"chapter_id" text NOT NULL,
	"correct_count" integer NOT NULL,
	"question_count" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quiz_attempt_counts_valid" CHECK ("quiz_attempt"."question_count" > 0 AND "quiz_attempt"."correct_count" >= 0 AND "quiz_attempt"."correct_count" <= "quiz_attempt"."question_count")
);
--> statement-breakpoint
CREATE TABLE "teacher_group" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"teacher_id" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"role" "user_role" DEFAULT 'student' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "chapter_progress" ADD CONSTRAINT "chapter_progress_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diploma" ADD CONSTRAINT "diploma_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_membership" ADD CONSTRAINT "group_membership_group_id_teacher_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."teacher_group"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_membership" ADD CONSTRAINT "group_membership_student_id_user_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_group_id_teacher_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."teacher_group"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_attempt" ADD CONSTRAINT "quiz_attempt_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teacher_group" ADD CONSTRAINT "teacher_group_teacher_id_user_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invitation_group_id_idx" ON "invitation" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "quiz_attempt_user_chapter_idx" ON "quiz_attempt" USING btree ("user_id","chapter_id");--> statement-breakpoint
CREATE INDEX "teacher_group_teacher_id_idx" ON "teacher_group" USING btree ("teacher_id");