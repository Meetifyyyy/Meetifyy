-- Remove E2EE infrastructure: EncryptedMessageTarget, Device, OneTimePreKey tables
-- and the senderDeviceId column from Message

-- DropForeignKey
ALTER TABLE "Device" DROP CONSTRAINT "Device_userId_fkey";

-- DropForeignKey
ALTER TABLE "EncryptedMessageTarget" DROP CONSTRAINT "EncryptedMessageTarget_deviceId_fkey";

-- DropForeignKey
ALTER TABLE "EncryptedMessageTarget" DROP CONSTRAINT "EncryptedMessageTarget_messageId_fkey";

-- DropForeignKey
ALTER TABLE "OneTimePreKey" DROP CONSTRAINT "OneTimePreKey_deviceId_fkey";

-- AlterTable
ALTER TABLE "Message" DROP COLUMN IF EXISTS "senderDeviceId";

-- DropTable
DROP TABLE IF EXISTS "EncryptedMessageTarget";

-- DropTable
DROP TABLE IF EXISTS "OneTimePreKey";

-- DropTable
DROP TABLE IF EXISTS "Device";
