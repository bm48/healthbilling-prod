TRUNCATE TABLE public.users RESTART IDENTITY CASCADE;

INSERT INTO public.users
(id, email, full_name, role, clinic_ids, highlight_color, created_at, updated_at, hourly_pay, active, password)
VALUES
(
'95c26f2f-327e-4fab-ac42-ef93c10a89b0',
'dana@transcendcf.com',
'Dana Schmitz',
'provider',
'{3f0b4f2a-54fd-4b27-bb9f-4263c317288a,39ac8ddc-6d40-43ec-8872-20a2482456a1}',
'#00f0b4',
'2026-03-02 00:02:07.784413+00',
'2026-04-27 23:29:49.150178+00',
NULL,
true,
'$2a$10$mpkLxKhJi8bK/yT.SwmMbuBj7JMKGHw0TIRjZU3UR2P4CIsM82Pai'
),

(
'5a27f481-a92e-464f-ae0a-9bbffeab5936',
'andrene@transcendmbw.com',
'Andrene Benjamin',
'provider',
'{39ac8ddc-6d40-43ec-8872-20a2482456a1}',
'#dc06f9',
'2026-03-13 01:59:40.857638+00',
'2026-03-13 02:00:02.355989+00',
NULL,
true,
'$2a$10$QpYfBGueia8/C2QiAH6gHOYqGVQUe/g4Ns.ROmeszcTHu/Cdq7jue'
),

(
'0e6a8774-ae11-431a-90e3-434635d16a99',
'muldersbert48@gmail.com',
'bert mulders',
'provider',
'{9c542bda-d9b7-4903-9bcb-37eecca7720d}',
'#eab308',
'2026-03-05 18:34:34.431228+00',
'2026-03-19 19:07:30.613891+00',
33.00,
true,
'$2a$10$bwAJIRS2JPUmU.qZgcGfheOMQEzUuNd1LxJS2eVxgJtNi4x1jSB72'
),

(
'd16d4dfb-ee6c-47d1-aa62-5b2f26d3aa9e',
'admin@amerbilling.com',
'Super Admin',
'super_admin',
'{}',
'#dc2626',
'2026-01-15 17:55:25.531923+00',
'2026-02-20 16:56:36.389001+00',
43.00,
true,
'$2a$10$KnIvQhtIgWs75Zh0E8qENegEfsu/UUohtXbfZJ/92cbg7B4pEqywC'
),

(
'46d3bb04-70bf-4d3d-9a29-c4a16644090f',
'jonvaldez@summerlandmentalhealth',
'Jon-Raymond Valdez',
'provider',
'{dffc9993-77ee-4ec6-83ec-fd0ed6ffd65f}',
'#0b44ef',
'2026-02-21 15:58:50.601558+00',
'2026-02-28 17:27:22.872692+00',
NULL,
true,
'$2a$10$bDLvTVbqtfi6QL2o4SYGZOu71in10P1gBXBK/QMR1dOuUvq18Szvi'
),

(
'fd02aa8d-e9fb-4bea-a6d6-4ae23819dfd4',
'providertest@gmail.com',
'provider test',
'provider',
'{9c542bda-d9b7-4903-9bcb-37eecca7720d}',
'#eab308',
'2026-03-19 18:49:44.03612+00',
'2026-03-19 19:17:08.095817+00',
22.00,
true,
'$2a$10$HLTcjd.Xl/ly6XhEZo8S/OXnrQv22yfnUNVTn2OpJ0Dh61TaM/3Fu'
),

(
'dd6cb279-e291-4794-b913-e418e6be4290',
'office@transcendmbw.com',
'Ashlyn Henry',
'office_staff',
'{}',
'#ffcd38',
'2026-03-03 15:19:23.233438+00',
'2026-03-03 15:19:23.580175+00',
NULL,
true,
'$2a$10$NBz8RRPnG9na7oOBR1/RZ.KLt6atgM7eVUKalslVX5EBQq4GhHHtS'
),

(
'139a8965-6b2e-4ef2-ad18-3b4890878486',
'jmurphy@myfocuspath.com',
'Jonathan Murphy',
'provider',
'{8cf4f148-1724-41f6-86a0-0da21a775b59}',
'#0099e6',
'2026-03-01 18:02:35.62953+00',
'2026-03-01 18:07:23.435057+00',
NULL,
true,
'$2a$10$6lZE9S0jqzc/H54kGOSZqulCwMabkLM/EefLFKBRTKNG7zY0IBmMW'
),

(
'84995792-f93e-47c2-8640-8f862b0b804c',
'spencer@transcendmbw.com',
'Spencer Winchester',
'provider',
'{39ac8ddc-6d40-43ec-8872-20a2482456a1}',
'#eab308',
'2026-04-07 21:24:51.179116+00',
'2026-04-07 21:25:12.473286+00',
NULL,
true,
'$2a$10$UAW1PbBuV/KHXvF5Vx834uqjZOXjnxX..hwK4Y6Sk6nubLxATKLCO'
),

(
'024abf26-7bf2-4083-ac74-6bb6c790a0f4',
'nicole.entenza@silvercrestmentalhealth.com',
'Nicole Entenza',
'provider',
'{31debb33-9b78-4304-9109-c042b0ff1579}',
'#eab308',
'2026-04-07 21:04:15.030455+00',
'2026-04-10 19:33:23.824639+00',
NULL,
true,
'$2a$10$zkeKWWsQjFAN7A5AJF8Z0eQPTiK2PnQ.mZGFEo9GWqzaGMcV9D1xm'
),

(
'77fd32d7-ebd6-463c-8d7c-de0886ea490e',
'nicole.entenza@summerlandmentalhealth.com',
'Nicole Entenza',
'provider',
'{dffc9993-77ee-4ec6-83ec-fd0ed6ffd65f}',
'#eab308',
'2026-04-07 21:05:11.824719+00',
'2026-04-10 19:36:28.571118+00',
NULL,
true,
'$2a$10$4.X9rhBNGe60ZXNOUVGNw.3weIshBBpvP9n/i0lRaiJBp1Mu23pX6'
),

(
'5e22a333-11b6-44b0-b725-40283fe23a41',
'keanafisher@yahoo.com',
'Keana Fisher',
'billing_staff',
'{9c542bda-d9b7-4903-9bcb-37eecca7720d,2c2db6a2-cf63-47ac-bfac-8820599acb8d}',
'#8000ff',
'2026-02-20 18:46:58.866967+00',
'2026-02-20 18:48:31.65481+00',
22.00,
true,
'$2a$10$t6EkZskyu6PQMc.heYXaieuQWwVOge7r36kySYgezVzaKN.pBwV/S'
),

(
'25697489-bd5c-44de-bae5-057815974fa1',
'admin@demo.com',
'admin demo',
'admin',
'{9c542bda-d9b7-4903-9bcb-37eecca7720d}',
'#3b82f6',
'2026-02-03 09:53:09.441075+00',
'2026-02-26 04:13:28.81635+00',
54.00,
true,
'$2a$10$yy1Pei7VXJwL4xdcP.c2ruEKArgp1mfDXX.ZMBQmH2W7BOC6aBTO6'
),

(
'dc65b371-c14d-4c50-9558-44768437d424',
'billing@demo.com',
'billing demo',
'billing_staff',
'{9c542bda-d9b7-4903-9bcb-37eecca7720d}',
'#e70808',
'2026-02-03 16:46:00.935985+00',
'2026-02-26 04:13:31.932267+00',
65.00,
true,
'$2a$10$8bsDiboi/bpnapasbODE4eNCrRWng/sb0PKSf4hUODzlnUrJGIjWm'
),

(
'f5423c7b-b960-444d-8f6c-c6de9da2951f',
'official@demo.com',
'official demo',
'office_staff',
'{9c542bda-d9b7-4903-9bcb-37eecca7720d}',
'#08e7cd',
'2026-02-03 18:06:07.889538+00',
'2026-02-26 04:13:38.390049+00',
32.00,
true,
'$2a$10$HjL9amewGwwW982jht4nd.TSTAWsoLqXGhSYaFU5gQCM8mC86Q6JG'
),

(
'3c6bbbe3-582c-4c07-be08-78244def16a5',
'morgan@transcendmbw.com',
'Morgan Huls',
'provider',
'{3f0b4f2a-54fd-4b27-bb9f-4263c317288a,39ac8ddc-6d40-43ec-8872-20a2482456a1}',
'#7affb4',
'2026-02-26 22:01:04.273258+00',
'2026-02-26 22:01:19.62811+00',
NULL,
true,
'$2a$10$qU86n6sX8i5cmWHZcGdKnukPjJ3fAP9MR256omqfcodGhu1n2mkFm'
),

(
'74458370-33fe-4a19-b75d-b0819d94175b',
'transcendcedarfalls@gmail.com',
'Morgan Huls',
'admin',
'{39ac8ddc-6d40-43ec-8872-20a2482456a1,3f0b4f2a-54fd-4b27-bb9f-4263c317288a}',
'#70ffc1',
'2026-03-02 22:36:05.498773+00',
'2026-03-02 22:38:24.856647+00',
NULL,
true,
'$2a$10$xMBccxSjBECnMp2iGwTimuH.hLo4aMjk73g.DepBQb.0HV5F4crQe'
),

(
'0f3a5973-3cfa-4deb-a54c-270612bc3169',
'kadesha@transcendcf.com',
'Kadesha Evans',
'provider',
'{3f0b4f2a-54fd-4b27-bb9f-4263c317288a}',
'#08e717',
'2026-03-03 04:19:23.006688+00',
'2026-03-03 04:19:44.621946+00',
NULL,
true,
'$2a$10$Q3GHYzKWYEVPyO9xHwyIA.VOGxuAtbQ9t3h72pMin7bGr2cHzSJfW'
);