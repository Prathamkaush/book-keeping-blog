import express from "express";
import axios from "axios";
import bodyParser from "body-parser";
import pg from "pg";
import session from "express-session";

const db = new pg.Client({
  user: "postgres",
  host: "localhost",
  database: "books",
  password: "Indu1975@123",
  port: 5432,
});
db.connect();


const app = express();
const port = 3000;

app.use(session({
  secret: "superSecretKey", 
  resave: false,
  saveUninitialized: true
}));

app.use(express.json());
app.set("view engine", "ejs");
app.use(express.static("public"));
app.use(bodyParser.urlencoded({ extended: true }));

let BOOKS = [
  {
    id: 1,
    title: "IKIGAI",
    isbn: 9780143130727,
    summary: "my book summary",
    date: new Date(),
    rating: "4/5",
    genres: "life changing",
  },
];


async function getBooksById(itemId) {
  const result = await db.query("SELECT m.id, m.title , m.summary , m.notes , o.date , o.rating , o.genre ,o.isbn FROM main as m JOIN other as o ON m.id = o.bookid;", [itemId]);
  return result.rows[0]; 
}


app.get("/", async (req, res) => {
  const result = await db.query(`
    SELECT m.id, m.title, m.summary, m.notes, o.date, o.rating, o.genre, o.isbn
    FROM main AS m
    JOIN other AS o ON m.id = o.bookid;
  `);

  const BOOKS = result.rows;

  if (BOOKS.length === 0) {
    return res.render("index", {
      books: [],
      imageUrl: null
    });
  }
res.render("index", {
    books: BOOKS,
    isAdmin: req.session.isAdmin || false,
    });
});

app.get("/new", (req, res) => {
  
  console.log("NEW BOOK FORM ROUTE HIT ✅");
  res.render( "edit.ejs", {submit: "Add Book"});
});


app.post("/posts", async (req, res) => {
  
  const { title, summary, notes, date, rating, genre, isbn } = req.body;
  try {
    await db.query("BEGIN");

    // Insert into main table and get the new id
const resultMain = await db.query(
  "INSERT INTO main (title, summary, notes) VALUES ($1, $2, $3) RETURNING id",
  [title, summary, notes]
);
const bookId = resultMain.rows[0].id;

await db.query(
  "INSERT INTO other (date, rating, genre, isbn, bookid) VALUES ($1, $2, $3, $4, $5)",
  [ date, rating, genre,isbn,bookId]
);
    await db.query("COMMIT");

    // Fetch updated list of books for homepage
    const allBooks = await db.query(`
      SELECT m.id, m.title, m.summary, m.notes, o.date, o.rating, o.genre, o.isbn
      FROM main AS m
      JOIN other AS o ON m.id = o.bookid
    `);

    // Dynamic cover image URLs for all books
    const booksWithCovers = allBooks.rows.map(book => ({
      ...book,
      coverUrl: `https://covers.openlibrary.org/b/isbn/${book.isbn}-M.jpg`
    }));

    res.render("index.ejs", { books: booksWithCovers ,isAdmin: req.session.isAdmin || false});

  } catch (err) {
    await db.query("ROLLBACK");
    console.error("Error adding new book:", err);
    res.status(500).send("Something went wrong.");
  }
});

app.get("/viewposts/:id", async (req, res) => {
  const postId = req.params.id;
 try {
    const result = await db.query(`
      
      SELECT m.id, m.title, m.summary, m.notes, 
             o.date, o.rating, o.genre, o.isbn
      FROM main AS m
      JOIN other AS o ON m.id = o.bookid
      WHERE m.id = $1
    `, [postId]);
  if (result.rows.length === 0) {
      return res.status(404).send("Book not found");
    }

    const book = result.rows[0]; // Get the matched book

    res.render("posts.ejs", { book,isAdmin: req.session.isAdmin || false});

  } catch (error) {
    console.error("Error fetching book:", error);
    res.status(500).send("Server Error");
  }
});

app.get("/editposts/:id" , async (req,res)=>{
  const postId = req.params.id;
  console.log(postId);
 try {
    const result = await db.query(`
      SELECT m.id, m.title, m.summary, m.notes, 
             o.date, o.rating, o.genre, o.isbn
      FROM main AS m
      JOIN other AS o ON m.id = o.bookid
      WHERE m.id = $1
    `, [postId]);
  if (result.rows.length === 0) {
      return res.status(404).send("Book not found");
    }
const book = result.rows[0]; // Get the matched book
    res.render("edit.ejs", { books : book ,
      submit : "update book",
      isAdmin: req.session.isAdmin || false
    });

  } catch (error) {
    console.error("Error fetching book:", error);
    res.status(500).send("Server Error");
  }
});

app.post("/posts/:id", async (req, res) => {
  const bookId = req.params.id;
  const { title, summary, notes, isbn, genre, rating, date } = req.body;

  try {
    await db.query(
      "UPDATE main SET title = $1, summary = $2, notes = $3 WHERE id = $4",
      [title, summary, notes, bookId]
    );

    await db.query(
      "UPDATE other SET date = $1, rating = $2, genre = $3, isbn = $4 WHERE bookid = $5",
      [date, rating , genre , isbn , bookId]
    );

    res.redirect("/");
  } catch (err) {
    console.error("Error updating book:", err);
    res.status(500).send("Something went wrong");
  }
});

app.post("/delete", async (req, res) => {
  const bookId = req.body.deletbookid;
console.log(bookId);
  try {
    // First delete from 'other' (child table)
    await db.query("DELETE FROM other WHERE bookid = $1", [bookId]);

    // Then delete from 'main' (parent table)
    await db.query("DELETE FROM main WHERE id = $1", [bookId]);

    res.redirect("/");
  } catch (err) {
    console.error("Error deleting book:", err);
    res.status(500).send("Something went wrong");
  }
});

app.get('/books/genre/:genre', async (req, res) => {
  const genre = req.params.genre;
  
  try {
    const result = await db.query(
      `SELECT m.id, m.title, m.summary, m.notes, 
              o.date, o.rating, o.genre, o.isbn
       FROM main AS m
       JOIN other AS o ON m.id = o.bookid
       WHERE o.genre = $1`,
      [genre]
    );

    const books = result.rows;
    
    res.render('books-by-genre.ejs', { books, genre,isAdmin: req.session.isAdmin || false }); // change to your template
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

app.get("/search", async (req, res) => {
  const query = req.query.q; // user input from search box

  try {
    const result = await db.query(
      `SELECT m.id, m.title, m.summary, m.notes, 
              o.date, o.rating, o.genre, o.isbn
       FROM main AS m
       JOIN other AS o ON m.id = o.bookid
       WHERE m.title ILIKE $1 OR m.summary ILIKE $1 OR o.genre ILIKE $1`,
      [`%${query}%`]
    );

    const books = result.rows;

    res.render("search-results.ejs", { query, books ,isAdmin: req.session.isAdmin || false});
  } catch (err) {
    console.error("Error searching books:", err);
    res.status(500).send("Something went wrong while searching.");
  }
});

const ADMIN_PASS = "mySecret123";


app.post("/admin-login", (req, res) => {
  const { password } = req.body;
  if (password === "Prath@1234!") {
    req.session.isAdmin = true;
    res.json({ success: true });
  } else {
    res.json({ success: false });
  }
});

app.post("/admin-logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error("Logout error:", err);
      return res.json({ success: false });
    }
    res.json({ success: true });
  });
});


app.listen(3000, '0.0.0.0', () => {
  console.log("Server running on 0.0.0.0:3000");
});
