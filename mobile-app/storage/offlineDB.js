import * as SQLite from "expo-sqlite";

const db = SQLite.openDatabase("offlineReports.db");

db.transaction((tx) => {
  tx.executeSql(
    "CREATE TABLE IF NOT EXISTS reports (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, details TEXT, status TEXT, imageUri TEXT);"
  );
});

export const saveReport = (title, details, status, imageUri) =>
  new Promise((resolve, reject) => {
    db.transaction((tx) => {
      tx.executeSql(
        "INSERT INTO reports (title, details, status, imageUri) VALUES (?, ?, ?, ?);",
        [title, details, status, imageUri],
        (_, result) => resolve(result.insertId),
        (_, error) => reject(error)
      );
    });
  });

export const getReports = () =>
  new Promise((resolve, reject) => {
    db.transaction((tx) => {
      tx.executeSql(
        "SELECT * FROM reports;",
        [],
        (_, { rows }) => resolve(rows._array),
        (_, error) => reject(error)
      );
    });
  });

export const clearReports = () =>
  new Promise((resolve, reject) => {
    db.transaction((tx) => {
      tx.executeSql(
        "DELETE FROM reports;",
        [],
        () => resolve(),
        (_, error) => reject(error)
      );
    });
  });
