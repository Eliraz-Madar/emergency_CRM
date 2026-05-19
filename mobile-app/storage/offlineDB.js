import { openDatabaseAsync } from "expo-sqlite";

const initDB = (async () => {
  const db = await openDatabaseAsync("offlineReports.db");
  await db.execAsync(
    "CREATE TABLE IF NOT EXISTS reports (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, details TEXT, status TEXT, imageUri TEXT);"
  );
  return db;
})();

export const saveReport = async (title, details, status, imageUri) => {
  const db = await initDB;
  const statement = await db.prepareAsync(
    "INSERT INTO reports (title, details, status, imageUri) VALUES (?, ?, ?, ?);"
  );

  try {
    const result = await statement.executeAsync(title, details, status, imageUri);
    return result.lastInsertRowId;
  } finally {
    await statement.finalizeAsync();
  }
};

export const getReports = async () => {
  const db = await initDB;
  const statement = await db.prepareAsync("SELECT * FROM reports;");

  try {
    const result = await statement.executeAsync();
    return await result.getAllAsync();
  } finally {
    await statement.finalizeAsync();
  }
};

export const clearReports = async () => {
  const db = await initDB;
  await db.execAsync("DELETE FROM reports;");
};
