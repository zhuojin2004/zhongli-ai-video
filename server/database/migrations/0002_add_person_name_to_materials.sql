-- 0002: 在 materials 表新增 person_name 字段 + 索引
-- 用途：员工素材库可按「人物姓名（如果有）」分组浏览
ALTER TABLE "materials" ADD COLUMN "person_name" varchar(100);
CREATE INDEX IF NOT EXISTS "materials_person_name_idx" ON "materials" ("person_name");