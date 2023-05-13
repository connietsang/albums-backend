const express = require('express');

const bodyParser = require('body-parser');

const cors = require('cors');

const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');

const mysql = require('mysql2/promise');

const app = express();

// import and load .env file
require('dotenv').config();

const port = process.env.PORT;

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME
});

app.use(async function mysqlConnection(req, res, next) {
  try {
    req.db = await pool.getConnection();
    req.db.connection.config.namedPlaceholders = true;

    // Traditional mode ensures not null is respected for unsupplied fields, ensures valid JavaScript dates, etc.
    await req.db.query('SET SESSION sql_mode = "TRADITIONAL"');
    await req.db.query(`SET time_zone = '-8:00'`);

    await next();

    req.db.release();
  } catch (err) {
    // If anything downstream throw an error, we must release the connection allocated for the request
    console.log(err)
    if (req.db) req.db.release();
    throw err;
  }
});

app.use(cors());

app.use(bodyParser.json());

// register a user
app.post('/register', async function (req, res) {
  try {
    let user;

    // Hashes the password and inserts the info into the `user` table
    await bcrypt.hash(req.body.password, 10).then(async hash => {
      try {
        [user] = await req.db.query(
          `INSERT INTO users (email, password)
          VALUES (:email, :password);`, 
        {
          email: req.body.email,
          password: hash
        });

      } catch (error) {
        console.log('error', error)
      }
    });

    const encodedUser = jwt.sign(
      { 
        userId: user.insertId,
        ...req.body
      },
      process.env.JWT_KEY
    );

    res.json(encodedUser);
  } catch (err) {
    console.log('err', err)
  }
});


app.post('/auth', async function (req, res) {
  try {
    const [[user]] = await req.db.query(`
      SELECT * FROM users WHERE email = :email
    `, {  
      email: req.body.email
    });

    if (!user) {
      res.json('Email not found');
    }

    console.log('user', user)

    const userPassword = `${user.password}`

    const compare = await bcrypt.compare(req.body.password, userPassword);

    if (compare) {
      const payload = {
        userId: user.userId,
        email: user.email,
        role: 2
      }
      
      const encodedUser = jwt.sign(payload, process.env.JWT_KEY);

      res.json(encodedUser)
    } else {
      res.json('Password not found');
    }
  } catch (err) {
    console.log('Error in /auth', err)
  }
})


 // Jwt verification checks to see if there is an authorization header with a valid jwt in it.
app.use(async function verifyJwt(req, res, next) {
  // console.log('REQUESTTTT', req.headers)
  if (!req.headers.authorization) {
    throw(401, 'Invalid authorization');
  }

  const [scheme, token] = req.headers.authorization.split(' ');

  console.log('[scheme, token]', scheme, ' ', token);

  if (scheme !== 'Bearer') {
    throw(401, 'Invalid authorization');
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_KEY);

    console.log('payload', payload)

    req.user = payload;
  } catch (err) {
    if (err.message && (err.message.toUpperCase() === 'INVALID TOKEN' || err.message.toUpperCase() === 'JWT EXPIRED')) {

      req.status = err.status || 500;
      req.body = err.message;
      req.app.emit('jwt-error', err, req);
    } else {

      throw((err.status || 500), err.message);
    }
    console.log(err)
  }

  await next();
});

// get all saved albums
app.get('/albums', async function (req,res){
  try {
  const [albums] = await req.db.query(
    `SELECT * FROM music`
  );
  res.json(albums);
  } catch(err){
    console.log('error', err)
  }
});


// get all albums by an artist
app.get('/artist/:artist', async function (req,res){
  try {
  const [albums] = await req.db.query(
    `SELECT * FROM music WHERE artist = :artist`,
    {
    artist: req.params.artist
    }
  );
  res.json(albums);
  } catch(err){
    console.log('error', err)
  }
});

// get all albums in list in this genre (general search)
app.get('/genre/:genre', async function (req,res){
  try{
  const [albums] = await req.db.query(
    'SELECT * FROM `music` WHERE `genre` LIKE :genre',
    {
      genre: '%' + req.params.genre + '%'
    }
  );
  res.json(albums);
  } catch (err){
    console.log('error', err)
  }
});

// get all albums with this name
app.get('/album/:album', async function (req,res){
  try {
  const [albums] = await req.db.query(
    `SELECT * FROM music WHERE album LIKE :album`,
    {
    album: '%' + req.params.album + '%'
    }
  );
  res.json(albums);
  } catch(err){
    console.log('error', err)
  }
});


app.get('year/:year', async function(req,res){
  try {
  const [albums] = await req.db.query(
    `SELECT * FROM music WHERE YEAR(year) = :year`,
    {
      year: req.params.year
    }
  );
  res.json(albums);
  } catch(err){
    console.log('error', err)
  }
});

app.post('/', async function (req,res){
  try{
    const album = await req.db.query(
      `INSERT INTO music (
        album,
        artist,
        genre,
        year 
        ) 
        VALUES (
        :album,
        :artist,
        :genre,
        :year
      )`,
      {
        album: req.body.album,
        artist: req.body.artist,
        genre: req.body.genre,
        year: req.body.year
      }
    );
    res.json(album)
  }catch(err){
    console.log('post /', err)
  }
});

// edit the genre of an album
app.put('/:album/:artist/', async function(req,res){
  try{
  const[albums] = await req.db.query(
    `UPDATE music SET genre =:genre WHERE artist = :artist AND album = :album`,
    {
      artist: req.params.artist,
      album: req.params.album,
      genre: req.body.genre
    }
  );
  res.json(albums)
  } catch(err){
    console.log('put /', err)
  }
});

// delete an album from the list
app.delete('/:album/:artist', async function(req,res){
  try{
    const [albums] = await req.db.query(
      `DELETE FROM music WHERE album = :album AND artist := artist`,
      {
        album: req.params.album,
        artist: req.params.artist
      }
    );
    res.json(albums)
    } catch(err){
      console.log('delete /', err)
    }
  }
);

app.listen(port, () => console.log(`Demo app listening at http://localhost:${port}`));

