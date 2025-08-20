import express from "express";
import bodyParser from "body-parser";
import session from "express-session";
import pg from "pg";
import connectPgSimpleImport from "connect-pg-simple";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Session store
const pgSession = connectPgSimpleImport(session);

// PostgreSQL pool
const db = new pg.Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASS,
  port: Number(process.env.DB_PORT),
   ssl: { rejectUnauthorized: false },
});

// Test DB connection
db.connect()
  .then(() => console.log("Connected to PostgreSQL"))
  .catch(err => console.error("DB connection error:", err));

// Session configuration
app.use(
  session({
    store: new pgSession({ pool: db, tableName: "session" }),
    secret: process.env.SESSION_SECRET || "superSecret",
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 }, // 30 days
  })
);

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());
// Home route
app.get("/", async (req, res) => {
  try {
    const result = await db.query(`
      SELECT m.id, m.title, m.summary, m.notes, o.date, o.rating, o.genre, o.isbn
      FROM main AS m
      JOIN other AS o ON m.id = o.bookid;
    `);

    const booksWithCovers = result.rows.map(book => ({
      ...book,
      coverUrl: `https://covers.openlibrary.org/b/isbn/${book.isbn}-M.jpg`,
    }));

    res.render("index", { books: booksWithCovers, isAdmin: req.session.isAdmin || false });
  } catch (err) {
    console.error("Error fetching books:", err);
    res.status(500).send(" not a Server Error");
  }
});

// Admin login
const ADMIN_PASS = process.env.ADMIN_PASS || "Prath@1234!";

app.post("/admin-login", (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASS) {
    req.session.isAdmin = true;
    res.json({ success: true });
  } else {
    res.json({ success: false });
  }
});

// Admin logout
app.post("/admin-logout", (req, res) => {
  req.session.destroy(err => {
    if (err) return res.json({ success: false });
    res.json({ success: true });
  });
});

// Add new book form
app.get("/new", (req, res) => {
  if (!req.session.isAdmin) return res.redirect("/");
  res.render("edit.ejs", { submit: "Add Book", isAdmin: true });
});

// Add new book
app.post("/posts", async (req, res) => {
  if (!req.session.isAdmin) return res.status(403).send("Unauthorized");

  const { title, summary, notes, date, rating, genre, isbn } = req.body;

  try {
    await db.query("BEGIN");

    const resultMain = await db.query(
      "INSERT INTO main (title, summary, notes) VALUES ($1, $2, $3) RETURNING id",
      [title, summary, notes]
    );
    const bookId = resultMain.rows[0].id;

    await db.query(
      "INSERT INTO other (date, rating, genre, isbn, bookid) VALUES ($1, $2, $3, $4, $5)",
      [date, rating, genre, isbn, bookId]
    );

    await db.query("COMMIT");
    res.redirect("/");
  } catch (err) {
    await db.query("ROLLBACK");
    console.error("Error adding new book:", err);
    res.status(500).send("Something went wrong");
  }
});

// Edit book form
app.get("/editposts/:id", async (req, res) => {
  if (!req.session.isAdmin) return res.redirect("/");

  const postId = req.params.id;
  try {
    const result = await db.query(
      `SELECT m.id, m.title, m.summary, m.notes, o.date, o.rating, o.genre, o.isbn
       FROM main AS m
       JOIN other AS o ON m.id = o.bookid
       WHERE m.id = $1`,
      [postId]
    );

    if (result.rows.length === 0) return res.status(404).send("Book not found");

    res.render("edit.ejs", { books: result.rows[0], submit: "Update Book", isAdmin: true });
  } catch (err) {
    console.error(err);
    res.status(500).send("Server Error");
  }
});

// Update book
app.post("/posts/:id", async (req, res) => {
  if (!req.session.isAdmin) return res.status(403).send("Unauthorized");

  const bookId = req.params.id;
  const { title, summary, notes, isbn, genre, rating, date } = req.body;

  try {
    await db.query(
      "UPDATE main SET title = $1, summary = $2, notes = $3 WHERE id = $4",
      [title, summary, notes, bookId]
    );

    await db.query(
      "UPDATE other SET date = $1, rating = $2, genre = $3, isbn = $4 WHERE bookid = $5",
      [date, rating, genre, isbn, bookId]
    );

    res.redirect("/");
  } catch (err) {
    console.error(err);
    res.status(500).send("Something went wrong");
  }
});

// Delete book
app.post("/delete", async (req, res) => {
  if (!req.session.isAdmin) return res.status(403).send("Unauthorized");

  const bookId = req.body.deletbookid;

  try {
    await db.query("DELETE FROM other WHERE bookid = $1", [bookId]);
    await db.query("DELETE FROM main WHERE id = $1", [bookId]);
    res.redirect("/");
  } catch (err) {
    console.error(err);
    res.status(500).send("Something went wrong");
  }
});

// Search books
app.get("/search", async (req, res) => {
  const query = req.query.q;
  try {
    const result = await db.query(
      `SELECT m.id, m.title, m.summary, m.notes, o.date, o.rating, o.genre, o.isbn
       FROM main AS m
       JOIN other AS o ON m.id = o.bookid
       WHERE m.title ILIKE $1 OR m.summary ILIKE $1 OR o.genre ILIKE $1`,
      [`%${query}%`]
    );
    res.render("search-results.ejs", { query, books: result.rows, isAdmin: req.session.isAdmin || false });
  } catch (err) {
    console.error(err);
    res.status(500).send("Error searching books.");
  }
});

// Books by genre
app.get("/books/genre/:genre", async (req, res) => {
  const genre = req.params.genre;
  try {
    const result = await db.query(
      `SELECT m.id, m.title, m.summary, m.notes, o.date, o.rating, o.genre, o.isbn
       FROM main AS m
       JOIN other AS o ON m.id = o.bookid
       WHERE o.genre = $1`,
      [genre]
    );
    res.render("books-by-genre.ejs", { books: result.rows, genre, isAdmin: req.session.isAdmin || false });
  } catch (err) {
    console.error(err);
    res.status(500).send("Server Error");
  }
});

app.get("/viewposts/:id", async (req, res) => {
  const postId = req.params.id;
  try {
    const result = await db.query(
      `SELECT m.id, m.title, m.summary, m.notes, o.date, o.rating, o.genre, o.isbn
       FROM main AS m
       JOIN other AS o ON m.id = o.bookid
       WHERE m.id = $1`,
      [postId]
    );

    if (result.rows.length === 0) return res.status(404).send("Book not found");

    res.render("posts.ejs", { book: result.rows[0], isAdmin: req.session.isAdmin || false });
  } catch (err) {
    console.error(err);
    res.status(500).send("Server Error");
  }
});

// Start server
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
