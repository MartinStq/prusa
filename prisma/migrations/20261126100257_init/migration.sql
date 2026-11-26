-- CreateTable
CREATE TABLE "PrintRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "clientName" TEXT NOT NULL,
    "clientEmail" TEXT NOT NULL,
    "stlFilename" TEXT NOT NULL,
    "stlPath" TEXT NOT NULL,
    "gcodeFilename" TEXT,
    "status" TEXT NOT NULL DEFAULT 'TO_ANALYZE',
    "verdict" TEXT,
    "weightGrams" REAL,
    "priceTvac" REAL,
    "operatorComment" TEXT,
    "needsDesignerMeeting" BOOLEAN NOT NULL DEFAULT false,
    "invoiced" BOOLEAN NOT NULL DEFAULT false,
    "invoicedAt" DATETIME
);
