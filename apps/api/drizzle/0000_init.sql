CREATE TYPE "public"."check_conclusion" AS ENUM('success', 'failure', 'neutral');--> statement-breakpoint
CREATE TYPE "public"."gate_status" AS ENUM('passed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."review_status" AS ENUM('queued', 'running', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."severity" AS ENUM('info', 'minor', 'major', 'critical', 'blocker');--> statement-breakpoint
CREATE TABLE "findings" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "findings_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"run_id" uuid NOT NULL,
	"analyzer" text NOT NULL,
	"rule" text NOT NULL,
	"severity" "severity" NOT NULL,
	"path" text,
	"line" integer,
	"end_line" integer,
	"message" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "installations" (
	"id" bigint PRIMARY KEY NOT NULL,
	"account_login" text NOT NULL,
	"account_type" text NOT NULL,
	"suspended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pull_requests" (
	"id" bigint PRIMARY KEY NOT NULL,
	"repository_id" bigint NOT NULL,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"author_login" text NOT NULL,
	"state" text NOT NULL,
	"draft" boolean DEFAULT false NOT NULL,
	"head_sha" text NOT NULL,
	"base_ref" text NOT NULL,
	"head_ref" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pull_requests_repository_number_key" UNIQUE("repository_id","number"),
	CONSTRAINT "pull_requests_state_check" CHECK ("pull_requests"."state" in ('open', 'closed', 'merged')),
	CONSTRAINT "pull_requests_head_sha_check" CHECK ("pull_requests"."head_sha" ~ '^[0-9a-f]{40}$')
);
--> statement-breakpoint
CREATE TABLE "repositories" (
	"id" bigint PRIMARY KEY NOT NULL,
	"installation_id" bigint NOT NULL,
	"full_name" text NOT NULL,
	"private" boolean NOT NULL,
	"default_branch" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pull_request_id" bigint NOT NULL,
	"head_sha" text NOT NULL,
	"status" "review_status" DEFAULT 'queued' NOT NULL,
	"gate_status" "gate_status",
	"conclusion" "check_conclusion",
	"counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"findings_count" integer DEFAULT 0 NOT NULL,
	"partial" boolean DEFAULT false NOT NULL,
	"check_run_id" bigint,
	"duration_ms" integer,
	"error" text,
	"queued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	CONSTRAINT "review_runs_pull_request_sha_key" UNIQUE("pull_request_id","head_sha"),
	CONSTRAINT "review_runs_head_sha_check" CHECK ("review_runs"."head_sha" ~ '^[0-9a-f]{40}$')
);
--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_run_id_review_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."review_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_requests" ADD CONSTRAINT "pull_requests_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repositories" ADD CONSTRAINT "repositories_installation_id_installations_id_fk" FOREIGN KEY ("installation_id") REFERENCES "public"."installations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_runs" ADD CONSTRAINT "review_runs_pull_request_id_pull_requests_id_fk" FOREIGN KEY ("pull_request_id") REFERENCES "public"."pull_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "findings_run_idx" ON "findings" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "findings_analyzer_idx" ON "findings" USING btree ("analyzer");--> statement-breakpoint
CREATE INDEX "repositories_installation_idx" ON "repositories" USING btree ("installation_id");--> statement-breakpoint
CREATE INDEX "review_runs_pull_request_idx" ON "review_runs" USING btree ("pull_request_id","queued_at" DESC NULLS LAST);