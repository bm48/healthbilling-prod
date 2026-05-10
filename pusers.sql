TRUNCATE TABLE public.users RESTART IDENTITY CASCADE;

INSERT INTO public.users VALUES ('d16d4dfb-ee6c-47d1-aa62-5b2f26d3aa9e', 'admin@amerbilling.com', 'Super Admin', 'super_admin', '{}', '#dc2626', '2026-01-15 09:55:25.531923-08', '2026-04-28 00:24:44.870216-07', 43.00, true, '$2a$10$KnIvQhtIgWs75Zh0E8qENegEfsu/UUohtXbfZJ/92cbg7B4pEqywC');

INSERT INTO public.users VALUES ('5a27f481-a92e-464f-ae0a-9bbffeab5936', 'andrene@transcendmbw.com', 'Andrene Benjamin', 'provider', '{39ac8ddc-6d40-43ec-8872-20a2482456a1}', '#dc06f9', '2026-03-12 18:59:40.857638-07', '2026-04-28 00:24:55.843192-07', NULL, true, '$2a$10$QpYfBGueia8/C2QiAH6gHOYqGVQUe/g4Ns.ROmeszcTHu/Cdq7jue');

INSERT INTO public.users VALUES ('dc65b371-c14d-4c50-9558-44768437d424', 'billing@demo.com', 'billing demo', 'billing_staff', '{9c542bda-d9b7-4903-9bcb-37eecca7720d}', '#e70808', '2026-02-03 08:46:00.935985-08', '2026-04-28 00:25:00.15426-07', 65.00, true, '$2a$10$8bsDiboi/bpnapasbODE4eNCrRWng/sb0PKSf4hUODzlnUrJGIjWm');

INSERT INTO public.users VALUES ('95c26f2f-327e-4fab-ac42-ef93c10a89b0', 'dana@transcendcf.com', 'Dana Schmitz', 'provider', '{3f0b4f2a-54fd-4b27-bb9f-4263c317288a,39ac8ddc-6d40-43ec-8872-20a2482456a1}', '#00f0b4', '2026-03-01 16:02:07.784413-08', '2026-04-28 00:25:05.261691-07', NULL, true, '$2a$10$mpkLxKhJi8bK/yT.SwmMbuBj7JMKGHw0TIRjZU3UR2P4CIsM82Pai');

INSERT INTO public.users VALUES ('139a8965-6b2e-4ef2-ad18-3b4890878486', 'jmurphy@myfocuspath.com', 'Jonathan Murphy', 'provider', '{8cf4f148-1724-41f6-86a0-0da21a775b59}', '#0099e6', '2026-03-01 10:02:35.62953-08', '2026-04-28 00:25:58.228743-07', NULL, true, '$2a$10$6lZE9S0jqzc/H54kGOSZqulCwMabkLM/EefLFKBRTKNG7zY0IBmMW');

INSERT INTO public.users VALUES ('46d3bb04-70bf-4d3d-9a29-c4a16644090f', 'jonvaldez@summerlandmentalhealth', 'Jon-Raymond Valdez', 'provider', '{dffc9993-77ee-4ec6-83ec-fd0ed6ffd65f}', '#0b44ef', '2026-02-21 07:58:50.601558-08', '2026-04-28 00:26:04.118218-07', NULL, true, '$2a$10$bDLvTVbqtfi6QL2o4SYGZOu71in10P1gBXBK/QMR1dOuUvq18Szvi');

INSERT INTO public.users VALUES ('0f3a5973-3cfa-4deb-a54c-270612bc3169', 'kadesha@transcendcf.com', 'Kadesha Evans', 'provider', '{3f0b4f2a-54fd-4b27-bb9f-4263c317288a}', '#08e717', '2026-03-02 20:19:23.006688-08', '2026-04-28 00:26:09.092412-07', NULL, true, '$2a$10$Q3GHYzKWYEVPyO9xHwyIA.VOGxuAtbQ9t3h72pMin7bGr2cHzSJfW');

INSERT INTO public.users VALUES ('5e22a333-11b6-44b0-b725-40283fe23a41', 'keanafisher@yahoo.com', 'Keana Fisher', 'billing_staff', '{9c542bda-d9b7-4903-9bcb-37eecca7720d,2c2db6a2-cf63-47ac-bfac-8820599acb8d}', '#8000ff', '2026-02-20 10:46:58.866967-08', '2026-04-28 00:26:19.177926-07', 22.00, true, '$2a$10$t6EkZskyu6PQMc.heYXaieuQWwVOge7r36kySYgezVzaKN.pBwV/S');

INSERT INTO public.users VALUES ('3c6bbbe3-582c-4c07-be08-78244def16a5', 'morgan@transcendmbw.com', 'Morgan Huls', 'provider', '{3f0b4f2a-54fd-4b27-bb9f-4263c317288a,39ac8ddc-6d40-43ec-8872-20a2482456a1}', '#7affb4', '2026-02-26 14:01:04.273258-08', '2026-04-28 00:26:34.023116-07', NULL, true, '$2a$10$qU86n6sX8i5cmWHZcGdKnukPjJ3fAP9MR256omqfcodGhu1n2mkFm');

INSERT INTO public.users VALUES ('024abf26-7bf2-4083-ac74-6bb6c790a0f4', 'nicole.entenza@silvercrestmentalhealth.com', 'Nicole Entenza', 'provider', '{31debb33-9b78-4304-9109-c042b0ff1579}', '#eab308', '2026-04-07 14:04:15.030455-07', '2026-04-28 00:26:51.106287-07', NULL, true, '$2a$10$zkeKWWsQjFAN7A5AJF8Z0eQPTiK2PnQ.mZGFEo9GWqzaGMcV9D1xm');

INSERT INTO public.users VALUES ('77fd32d7-ebd6-463c-8d7c-de0886ea490e', 'nicole.entenza@summerlandmentalhealth.com', 'Nicole Entenza', 'provider', '{dffc9993-77ee-4ec6-83ec-fd0ed6ffd65f}', '#eab308', '2026-04-07 14:05:11.824719-07', '2026-04-28 00:26:57.490024-07', NULL, true, '$2a$10$4.X9rhBNGe60ZXNOUVGNw.3weIshBBpvP9n/i0lRaiJBp1Mu23pX6');

-- continue ALL remaining INSERT statements here exactly the same way