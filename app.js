const express = require('express')
const session = require('express-session')
const flash = require('connect-flash')
const markdown = require('marked')
const MongoStore = require('connect-mongo')
const csrf = require('csurf')
const app = express()
const sanitizeHTML = require('sanitize-html')

app.use(express.urlencoded({extended: false})) // accepting form data in req.body
app.use(express.json()) //accepting json data in req.body

// none of the app.use after this line is applied to api routers -> order matters
app.use('/api', require('./router-api'))

let sessionOptions = session({
    secret: "JavaScript is good",
    store: MongoStore.create({client: require('./db')}), // save session to mongo (deafult is to store in memory)
    resave: false,
    saveUninitialized: false,
    cookie: {maxAge: 1000 * 60 * 60 * 24, httpOnly: true}
})

app.use(sessionOptions)
app.use(flash())

// middleware function for reducing duplication of passing data to router
app.use(function(req, res, next) {
    // make our markdown function available from within eis templates
    res.locals.filterUserHTML = function(content) {
        return sanitizeHTML(markdown.parse(content), {allowedTags: ['p', 'br', 'ul', 'ol', 'li', 'strong', 'bold', 'i', 'em', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'], allowedAttributes: {}}) 
    }

    // make all error and success flash messages available from all templates
    res.locals.errors = req.flash('errors')
    res.locals.success = req.flash('success')

    // make current user id available on the req object
    if (req.session.user) { req.visitorId = req.session.user._id} else {req.visitorId = 0}

    // make user session data available from within view templates
    res.locals.user = req.session.user
    next()
})

const router = require('./router') // require() executes the file (immediately at app start-up) and returns the exports

app.use(express.static('public'))
app.set('views', 'views') // configure express. 1st 'views'is express's view, 2nd one is the folder I created
app.set('view engine', 'ejs')

app.use(csrf())

app.use(function(req, res, next) {
    res.locals.csrfToken = req.csrfToken()
    next()
})

app.use('/', router)

app.use(function(err, req, res, next) {
    if (err) {
        if (err.code == "EBADCSRFTOKEN") {
            req.flash('errors', "Cross site requst forgery detected.")
            req.session.save(() => res.redirect('/'))
        } else {
            res.render("404")
        }
    }
})

const server = require('http').createServer(app)
const io = require('socket.io')(server)

io.use(function(socket, next){
    sessionOptions(socket.request, socket.request.res, next)
})

io.on('connection', function(socket) {
    if (socket.request.session.user) {
        let user = socket.request.session.user

        socket.emit('welcome', {username: user.username, avatar: user.avatar})

        socket.on('chatMessageFromBrowser', function(data) {
            // emit -> send to all connected user(browsers) broadcast.emit -> send to everyone except msg origin
            socket.broadcast.emit('chatMessageFromServer', {message: sanitizeHTML(data.message, {allowedTags: [], allowedAttributes: {}}), username: user.username, avatar: user.avatar}) 
        })
    }
})

module.exports = server