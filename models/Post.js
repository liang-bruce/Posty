// best practice to save id into MongoDB is new ObjectID, not by string
const ObjectID = require('mongodb').ObjectId
const postCollection = require('../db').db().collection('posts')
const followsCollection = require('../db').db().collection('follows')
const User = require('./User')
const sanitizeHTML = require('sanitize-html')


let Post = function (data, userid, requestedPostId) {
    this.data = data
    this.userid = userid
    this.requestedPostId = requestedPostId
    this.errors = []
}

Post.prototype.cleanUp = function() {
    if (typeof(this.data.title) != 'string') { this.data.title = ''}
    if (typeof(this.data.body) != 'string') { this.data.body = ''}

    // get rid of any bogus properties
    this.data = {
        title: sanitizeHTML(this.data.title.trim(), {allowedTags: [], allowedAttributes: {}}),
        body: sanitizeHTML(this.data.body.trim(), {allowedTags: [], allowedAttributes: {}}),
        createdDate: new Date(),
        author: new ObjectID(this.userid)
    }
        
}

Post.prototype.validate = function() {
    if (this.data.title == '') { this.errors.push('You must provode a title')}
    if (this.data.body == '') { this.errors.push('You must provode post content')}
}

Post.prototype.create = function() {
    return new Promise((resolve, reject) => {
        this.cleanUp()
        this.validate()
        if (!this.errors.length) {
            // save post into database
            postCollection.insertOne(this.data).then((info) => {
                resolve(info.insertedId)
            }).catch((e) => {
                console.log(e)
                this.errors.push('Please try again later.')
                reject(this.errors)
            })
        } else {
            reject(this.errors)
        }
    })
}

Post.prototype.update = function() {
    return new Promise(async (resolve, reject) => {
        try {
            let post = await Post.findSingleById(this.requestedPostId, this.userid)
            if (post.isVisitorOwner) {
                // actually update the db
                let status = await this.updateDb()
                resolve(status)
            } else {
                reject()
            }
        } catch {
            reject()
        }
    })
}

Post.prototype.updateDb = function () {
    return new Promise(async (resolve, reject) => {
        this.cleanUp()
        this.validate()
        if (!this.errors.length) {
            await postCollection.findOneAndUpdate({_id: new ObjectID(this.requestedPostId)}, 
                {$set: {title: this.data.title, body: this.data.body}})
            resolve('success')
        } else {
            resolve('failure')
        }
    })
}

Post.reusablePostQuery = function(uniqueOperations, visitorId, finalOperations = []) {
    return new Promise(async function(resolve, reject) {
        let aggOperations = uniqueOperations.concat([
            {$lookup: {from: 'users', localField: 'author', foreignField: '_id', as: 'authorDocument'}},
            // lookup from user collection, localField and forreignField are like primary key and foreign key in SQL
            // as property: MongoDB will use this name when it adds on a virtual field / property with the matching user document to this post
            // in this form: note.txt
            {$project: {
                title: 1,
                body: 1,
                createdDate: 1,
                authorId: '$author',
                author: {$arrayElemAt: ['$authorDocument', 0]}
            }}
        ]).concat(finalOperations)

        let posts = await postCollection.aggregate(aggOperations).toArray()

        // clean up author property in each post object        
        posts = posts.map(function(post) {
            
            post.isVisitorOwner = post.authorId.equals(visitorId)
            // can use delete post.authorId but below is more efficient
            post.authorId = undefined
            post.author = {
                username: post.author.username,
                avatar: new User(post.author, true).avatar
            }
            return post
        })

        resolve(posts)
    })
}

Post.findSingleById = function(id, visitorId) {
    return new Promise(async function(resolve, reject) {
        if (typeof(id) != 'string' || !ObjectID.isValid(id)) {
            reject()
            return
        }
        
        let posts = await Post.reusablePostQuery([
            {$match: {_id: new ObjectID(id)}}
        ], visitorId)

        if (posts.length) {
            resolve(posts[0])
        } else {
            reject()
        }
    })
}

Post.findByAuthorId = function(authorId) {
    return Post.reusablePostQuery([
        {$match: {author: authorId}},
        {$sort: {createdDate: -1}}
    ])
}

Post.delete = function(postIdToDelete, currentUserId) {
    return new Promise(async (resolve, reject) => {
        try {
            let post = await Post.findSingleById(postIdToDelete, currentUserId)
            if (post.isVisitorOwner) {
                await postCollection.deleteOne({_id: new ObjectID(postIdToDelete)})
                resolve()
            } else {
                reject()    
            }
        } catch(e) {
            console.log(e)
            reject()
        }
    })
}

Post.search = function(searchTerm) {
    return new Promise(async (resolve, reject) => {
        if (typeof(searchTerm) == "string") {
            let posts = await Post.reusablePostQuery([
                {$match: {$text: {$search: searchTerm}}}
            ], undefined, [{$sort:{score: {$meta: "textScore"}}}])
            resolve(posts)
        } else {
            reject()
        }
    })
}

Post.countPostsByAuthor = function(id) {
    return new Promise(async (resolve, reject) => {
        let postCount = await postCollection.countDocuments({author: id})
        resolve(postCount)
    })
}

Post.getFeed = async function(id) {
    // create an array of the user IDs that the current user follows
    let followedUsers = await followsCollection.find({authorId: new ObjectID(id)}).toArray()
    followedUsers = followedUsers.map((followDoc) => followDoc.followedId)

    // look for posts where the author is in the above array of followed users
    return Post.reusablePostQuery([
        {$match: {author: {$in: followedUsers}}},
        {$sort: {createdDate: -1}}
    ])
}

module.exports = Post