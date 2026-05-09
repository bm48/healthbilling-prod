/*
 Navicat Premium Dump SQL

 Source Server         : amerbilling
 Source Server Type    : PostgreSQL
 Source Server Version : 170007 (170007)
 Source Host           : localhost:5432
 Source Catalog        : amerbilling
 Source Schema         : public

 Target Server Type    : PostgreSQL
 Target Server Version : 170007 (170007)
 File Encoding         : 65001

 Date: 09/05/2026 14:10:17
*/


-- ----------------------------
-- Table structure for users
-- ----------------------------
DROP TABLE IF EXISTS "public"."users";
CREATE TABLE "public"."users" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "email" text COLLATE "pg_catalog"."default" NOT NULL,
  "full_name" text COLLATE "pg_catalog"."default",
  "role" text COLLATE "pg_catalog"."default" NOT NULL,
  "clinic_ids" uuid[] DEFAULT '{}'::uuid[],
  "highlight_color" text COLLATE "pg_catalog"."default",
  "created_at" timestamptz(6) DEFAULT now(),
  "updated_at" timestamptz(6) DEFAULT now(),
  "hourly_pay" numeric(10,2),
  "active" bool NOT NULL DEFAULT true,
  "password" varchar(255) COLLATE "pg_catalog"."default"
)
;

-- ----------------------------
-- Records of users
-- ----------------------------
INSERT INTO "public"."users" VALUES ('d16d4dfb-ee6c-47d1-aa62-5b2f26d3aa9e', 'admin@amerbilling.com', 'Super Admin', 'super_admin', '{}', '#dc2626', '2026-01-15 09:55:25.531923-08', '2026-04-28 00:24:44.870216-07', 43.00, 't', '$2a$10$KnIvQhtIgWs75Zh0E8qENegEfsu/UUohtXbfZJ/92cbg7B4pEqywC');
INSERT INTO "public"."users" VALUES ('5a27f481-a92e-464f-ae0a-9bbffeab5936', 'andrene@transcendmbw.com', 'Andrene Benjamin', 'provider', '{39ac8ddc-6d40-43ec-8872-20a2482456a1}', '#dc06f9', '2026-03-12 18:59:40.857638-07', '2026-04-28 00:24:55.843192-07', NULL, 't', '$2a$10$QpYfBGueia8/C2QiAH6gHOYqGVQUe/g4Ns.ROmeszcTHu/Cdq7jue');
INSERT INTO "public"."users" VALUES ('dc65b371-c14d-4c50-9558-44768437d424', 'billing@demo.com', 'billing demo', 'billing_staff', '{9c542bda-d9b7-4903-9bcb-37eecca7720d}', '#e70808', '2026-02-03 08:46:00.935985-08', '2026-04-28 00:25:00.15426-07', 65.00, 't', '$2a$10$8bsDiboi/bpnapasbODE4eNCrRWng/sb0PKSf4hUODzlnUrJGIjWm');
INSERT INTO "public"."users" VALUES ('95c26f2f-327e-4fab-ac42-ef93c10a89b0', 'dana@transcendcf.com', 'Dana Schmitz', 'provider', '{3f0b4f2a-54fd-4b27-bb9f-4263c317288a,39ac8ddc-6d40-43ec-8872-20a2482456a1}', '#00f0b4', '2026-03-01 16:02:07.784413-08', '2026-04-28 00:25:05.261691-07', NULL, 't', '$2a$10$mpkLxKhJi8bK/yT.SwmMbuBj7JMKGHw0TIRjZU3UR2P4CIsM82Pai');
INSERT INTO "public"."users" VALUES ('139a8965-6b2e-4ef2-ad18-3b4890878486', 'jmurphy@myfocuspath.com', 'Jonathan Murphy', 'provider', '{8cf4f148-1724-41f6-86a0-0da21a775b59}', '#0099e6', '2026-03-01 10:02:35.62953-08', '2026-04-28 00:25:58.228743-07', NULL, 't', '$2a$10$6lZE9S0jqzc/H54kGOSZqulCwMabkLM/EefLFKBRTKNG7zY0IBmMW');
INSERT INTO "public"."users" VALUES ('46d3bb04-70bf-4d3d-9a29-c4a16644090f', 'jonvaldez@summerlandmentalhealth', 'Jon-Raymond Valdez', 'provider', '{dffc9993-77ee-4ec6-83ec-fd0ed6ffd65f}', '#0b44ef', '2026-02-21 07:58:50.601558-08', '2026-04-28 00:26:04.118218-07', NULL, 't', '$2a$10$bDLvTVbqtfi6QL2o4SYGZOu71in10P1gBXBK/QMR1dOuUvq18Szvi');
INSERT INTO "public"."users" VALUES ('0f3a5973-3cfa-4deb-a54c-270612bc3169', 'kadesha@transcendcf.com', 'Kadesha Evans', 'provider', '{3f0b4f2a-54fd-4b27-bb9f-4263c317288a}', '#08e717', '2026-03-02 20:19:23.006688-08', '2026-04-28 00:26:09.092412-07', NULL, 't', '$2a$10$Q3GHYzKWYEVPyO9xHwyIA.VOGxuAtbQ9t3h72pMin7bGr2cHzSJfW');
INSERT INTO "public"."users" VALUES ('5e22a333-11b6-44b0-b725-40283fe23a41', 'keanafisher@yahoo.com', 'Keana Fisher', 'billing_staff', '{9c542bda-d9b7-4903-9bcb-37eecca7720d,2c2db6a2-cf63-47ac-bfac-8820599acb8d}', '#8000ff', '2026-02-20 10:46:58.866967-08', '2026-04-28 00:26:19.177926-07', 22.00, 't', '$2a$10$t6EkZskyu6PQMc.heYXaieuQWwVOge7r36kySYgezVzaKN.pBwV/S');
INSERT INTO "public"."users" VALUES ('3c6bbbe3-582c-4c07-be08-78244def16a5', 'morgan@transcendmbw.com', 'Morgan Huls', 'provider', '{3f0b4f2a-54fd-4b27-bb9f-4263c317288a,39ac8ddc-6d40-43ec-8872-20a2482456a1}', '#7affb4', '2026-02-26 14:01:04.273258-08', '2026-04-28 00:26:34.023116-07', NULL, 't', '$2a$10$qU86n6sX8i5cmWHZcGdKnukPjJ3fAP9MR256omqfcodGhu1n2mkFm');
INSERT INTO "public"."users" VALUES ('024abf26-7bf2-4083-ac74-6bb6c790a0f4', 'nicole.entenza@silvercrestmentalhealth.com', 'Nicole Entenza', 'provider', '{31debb33-9b78-4304-9109-c042b0ff1579}', '#eab308', '2026-04-07 14:04:15.030455-07', '2026-04-28 00:26:51.106287-07', NULL, 't', '$2a$10$zkeKWWsQjFAN7A5AJF8Z0eQPTiK2PnQ.mZGFEo9GWqzaGMcV9D1xm');
INSERT INTO "public"."users" VALUES ('77fd32d7-ebd6-463c-8d7c-de0886ea490e', 'nicole.entenza@summerlandmentalhealth.com', 'Nicole Entenza', 'provider', '{dffc9993-77ee-4ec6-83ec-fd0ed6ffd65f}', '#eab308', '2026-04-07 14:05:11.824719-07', '2026-04-28 00:26:57.490024-07', NULL, 't', '$2a$10$4.X9rhBNGe60ZXNOUVGNw.3weIshBBpvP9n/i0lRaiJBp1Mu23pX6');
INSERT INTO "public"."users" VALUES ('dd6cb279-e291-4794-b913-e418e6be4290', 'office@transcendmbw.com', 'Ashlyn Henry', 'office_staff', '{}', '#ffcd38', '2026-03-03 07:19:23.233438-08', '2026-04-28 00:27:01.947593-07', NULL, 't', '$2a$10$NBz8RRPnG9na7oOBR1/RZ.KLt6atgM7eVUKalslVX5EBQq4GhHHtS');
INSERT INTO "public"."users" VALUES ('f5423c7b-b960-444d-8f6c-c6de9da2951f', 'official@demo.com', 'official demo', 'office_staff', '{9c542bda-d9b7-4903-9bcb-37eecca7720d}', '#08e7cd', '2026-02-03 10:06:07.889538-08', '2026-04-28 00:27:06.738321-07', 32.00, 't', '$2a$10$HjL9amewGwwW982jht4nd.TSTAWsoLqXGhSYaFU5gQCM8mC86Q6JG');
INSERT INTO "public"."users" VALUES ('fd02aa8d-e9fb-4bea-a6d6-4ae23819dfd4', 'providertest@gmail.com', 'provider test', 'provider', '{9c542bda-d9b7-4903-9bcb-37eecca7720d}', '#eab308', '2026-03-19 11:49:44.03612-07', '2026-04-28 00:27:55.741926-07', 22.00, 't', '$2a$10$HLTcjd.Xl/ly6XhEZo8S/OXnrQv22yfnUNVTn2OpJ0Dh61TaM/3Fu');
INSERT INTO "public"."users" VALUES ('84995792-f93e-47c2-8640-8f862b0b804c', 'spencer@transcendmbw.com', 'Spencer Winchester', 'provider', '{39ac8ddc-6d40-43ec-8872-20a2482456a1}', '#eab308', '2026-04-07 14:24:51.179116-07', '2026-04-28 00:28:01.418177-07', NULL, 't', '$2a$10$UAW1PbBuV/KHXvF5Vx834uqjZOXjnxX..hwK4Y6Sk6nubLxATKLCO');
INSERT INTO "public"."users" VALUES ('74458370-33fe-4a19-b75d-b0819d94175b', 'transcendcedarfalls@gmail.com', 'Morgan Huls', 'admin', '{39ac8ddc-6d40-43ec-8872-20a2482456a1,3f0b4f2a-54fd-4b27-bb9f-4263c317288a}', '#70ffc1', '2026-03-02 14:36:05.498773-08', '2026-04-28 00:28:04.761412-07', NULL, 't', '$2a$10$xMBccxSjBECnMp2iGwTimuH.hLo4aMjk73g.DepBQb.0HV5F4crQe');
INSERT INTO "public"."users" VALUES ('0e6a8774-ae11-431a-90e3-434635d16a99', 'muldersbert48@gmail.com', 'bert mulders', 'provider', '{9c542bda-d9b7-4903-9bcb-37eecca7720d}', '#eab308', '2026-03-05 10:34:34.431228-08', '2026-04-28 02:11:45.874816-07', 33.00, 't', '$2a$10$/Z9hcnIkqhKqMj1LDdg9s.4IPO2dbSXBFS9m5DtRKZznu59WBPUva');
INSERT INTO "public"."users" VALUES ('25697489-bd5c-44de-bae5-057815974fa1', 'admin@demo.com', 'admin demo', 'admin', '{9c542bda-d9b7-4903-9bcb-37eecca7720d,8cf4f148-1724-41f6-86a0-0da21a775b59}', '#3b82f6', '2026-02-03 01:53:09.441075-08', '2026-04-28 01:14:09.276885-07', 54.00, 't', '$2a$10$OL7elNEO9NsfNupNQxKt8u9PXQYxUiX0ljm2ENRiPelRkbPFm4bRO');

-- ----------------------------
-- Indexes structure for table users
-- ----------------------------
CREATE INDEX "idx_users_clinic_ids" ON "public"."users" USING gin (
  "clinic_ids" "pg_catalog"."array_ops"
);

-- ----------------------------
-- Uniques structure for table users
-- ----------------------------
ALTER TABLE "public"."users" ADD CONSTRAINT "users_email_key" UNIQUE ("email");

-- ----------------------------
-- Checks structure for table users
-- ----------------------------
ALTER TABLE "public"."users" ADD CONSTRAINT "users_role_check" CHECK (role = ANY (ARRAY['super_admin'::text, 'admin'::text, 'view_only_admin'::text, 'billing_staff'::text, 'view_only_billing'::text, 'provider'::text, 'office_staff'::text, 'official_staff'::text]));

-- ----------------------------
-- Primary Key structure for table users
-- ----------------------------
ALTER TABLE "public"."users" ADD CONSTRAINT "users_pkey" PRIMARY KEY ("id");
